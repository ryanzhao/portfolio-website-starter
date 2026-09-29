import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const execute = promisify(execFile);

// PC-only. Caller supplies a private per-job output directory; failures retain files.
export async function videoVariants(input, outputDir, { signal } = {}) {
  const ffmpeg = process.env.FFMPEG_PATH, ffprobe = process.env.FFPROBE_PATH;
  if (!ffmpeg || !ffprobe) throw new Error("请配置本机 FFMPEG_PATH 和 FFPROBE_PATH。");
  const source = resolve(input);
  const size = await stat(source);
  if (!size.isFile() || size.size <= 0 || size.size > 2 * 1024 ** 3) throw new Error("视频为空或超过 2 GiB。");
  const video = join(resolve(outputDir), "video.mp4"), poster = join(resolve(outputDir), "poster.webp");
  const reservation = await open(join(resolve(outputDir), ".processing"), "wx");
  await reservation.close();
  for (const path of [video, poster]) {
    const existing = await stat(path).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    if (existing) throw new Error("输出文件已存在，请使用新的任务目录。");
  }
  const run = async (binary, args, timeout = 120000) => {
    try { return await execute(binary, args, { windowsHide: true, timeout, signal, maxBuffer: 1024 * 1024 }); }
    catch { throw new Error(signal?.aborted ? "视频处理已停止。" : "视频处理失败或超时；原文件未删除，请检查本机工具及素材。"); }
  };
  const probe = async path => JSON.parse((await run(ffprobe, ["-v", "error", "-protocol_whitelist", "file,pipe",
    "-show_streams", "-show_format", "-of", "json", path])).stdout);
  const original = await probe(source);
  const track = original.streams.find(s => s.codec_type === "video");
  if (!track || !Number.isFinite(Number(original.format.duration)) || Number(original.format.duration) <= 0 ||
    !track.width || !track.height || track.width * track.height > 40_000_000) throw new Error("视频尺寸或时长无效。");
  const common = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-xerror", "-protocol_whitelist", "file,pipe", "-threads", "2"];
  await run(ffmpeg, [...common, "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1",
    "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", video], 2 * 60 * 60 * 1000);
  await run(ffmpeg, [...common, "-i", video, "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=w='min(1600,iw)':h=-2", "-c:v", "libwebp", "-threads", "2", poster]);
  await run(ffmpeg, [...common, "-i", video, "-f", "null", "-"], 2 * 60 * 60 * 1000);
  const checked = await probe(video);
  const rendered = checked.streams.find(s => s.codec_type === "video");
  if (rendered?.codec_name !== "h264" || rendered.pix_fmt !== "yuv420p") throw new Error("网页视频校验失败。");
  const posterInfo = (await probe(poster)).streams.find(s => s.codec_type === "video");
  if (posterInfo?.codec_name !== "webp" || !posterInfo.width || !posterInfo.height) throw new Error("视频封面校验失败。");
  const files = [];
  for (const [path, mimeType, role, dimensions] of [[poster, "image/webp", "poster", posterInfo], [video, "video/mp4", "video", rendered]]) {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(path, { signal })) { hash.update(chunk); size += chunk.length; }
    if (!size) throw new Error("处理结果为空。");
    files.push({ path, mimeType, role, size, sha256: hash.digest("hex"), width: dimensions.width, height: dimensions.height,
      ...(role === "video" ? { duration: Number(checked.format.duration) } : {}) });
  }
  return { video, poster, files, width: rendered.width, height: rendered.height, duration: Number(checked.format.duration) };
}
