import { setTimeout } from "node:timers/promises";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("用法：node scripts/process-media.mjs --once | --watch\n环境变量：PROCESSOR_ORIGIN、PROCESSOR_TOKEN、PROCESSOR_WORK_DIR；视频还需 FFMPEG_PATH、FFPROBE_PATH。\n--once 处理一个任务；--watch 每 5 秒检查队列。Ctrl+C 停止，不自动发布，不安装自启动。");
} else if (args.length !== 1 || !["--once", "--watch"].includes(args[0])) {
  console.error("只接受 --once、--watch 或 --help；密钥不可作为命令行参数。");
  process.exitCode = 1;
} else if (["PROCESSOR_ORIGIN", "PROCESSOR_TOKEN", "PROCESSOR_WORK_DIR"].some(name => !process.env[name])) {
  console.error("请配置 PROCESSOR_ORIGIN、PROCESSOR_TOKEN、PROCESSOR_WORK_DIR。");
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const { runProcessorJob } = await import("./processor-run.mjs");
    do {
      let delay = 5000;
      try {
      const result = await runProcessorJob(process.env.PROCESSOR_ORIGIN, process.env.PROCESSOR_TOKEN,
        process.env.PROCESSOR_WORK_DIR, { signal: controller.signal, access: {
          clientId: process.env.CF_ACCESS_CLIENT_ID, clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
        } });
      if (result) console.log(`处理完成：${result.assetId}；尚未发布。`);
      else if (args[0] === "--once") console.log("没有待处理任务。");
      } catch (error) {
        if (args[0] === "--once" || controller.signal.aborted) throw error;
        console.error("本次处理未完成，原件保留。30 秒后继续检查队列；失败素材请在后台确认后重试。");
        delay = 30000;
      }
      if (args[0] === "--once") break;
      await setTimeout(delay, undefined, { signal: controller.signal });
    } while (!controller.signal.aborted);
  } catch {
    if (!controller.signal.aborted) {
      console.error("处理未完成，已停止。请检查配置及后台任务状态；本机文件保留，不自动重试或发布。");
      process.exitCode = 1;
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (controller.signal.aborted) console.log("已停止；本机文件保留，未自动发布。");
  }
}
