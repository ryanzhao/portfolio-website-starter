import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

test("local video processing creates decoded MP4 and poster without overwriting input", { skip: !process.env.FFMPEG_PATH || !process.env.FFPROBE_PATH }, async () => {
  const api = await import("../scripts/local-video.mjs").catch(() => ({}));
  assert.equal(typeof api.videoVariants, "function");
  const dir = await mkdtemp(join(tmpdir(), "portfolio-video-test-"));
  const input = join(dir, "input.mp4");
  await run(process.env.FFMPEG_PATH, ["-v", "error", "-n", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", input]);
  const before = await stat(input);
  const output = join(dir, "output");
  await mkdir(output);
  const result = await api.videoVariants(input, output);
  assert.equal(result.width, 320);
  assert.equal(result.height, 240);
  assert.ok(result.duration > 0);
  assert.ok((await stat(result.poster)).size > 0);
  assert.equal(result.files.length, 2);
  const { validateProcessingResult } = await import("../src/lib/processing-result.ts");
  const files = result.files.map(({ path, ...file }) => { assert.ok(path); return file; });
  assert.equal(validateProcessingResult(crypto.randomUUID(), "video", { files }).files.length, 2);
  for (const file of result.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(file.size, (await stat(file.path)).size);
  }
  assert.equal((await stat(input)).mtimeMs, before.mtimeMs);
  await assert.rejects(api.videoVariants(input, output));
});
