import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isStepFile, modelVariants } from "../scripts/local-model.mjs";

test("STEP recognition is based on bytes; rejected files and cancellation retain the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portfolio-step-reject-"));
  const source = join(directory, "original");
  await writeFile(source, "not STEP");
  assert.equal(await isStepFile(source), false);
  await assert.rejects(modelVariants(source, directory));
  await assert.rejects(modelVariants(source, directory, { signal: AbortSignal.abort() }));
  assert.equal(await readFile(source, "utf8"), "not STEP");
});

test("real CadQuery STEP assembly converts to bounded self-contained GLB with source retained", {
  skip: !process.env.STEP_PYTHON_PATH,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "portfolio-step-real-"));
  const source = join(directory, "original");
  await promisify(execFile)(process.env.STEP_PYTHON_PATH, ["-I", "-c",
    "import cadquery as cq,sys; a=cq.Assembly(); a.add(cq.Workplane('XY').box(10,20,30),name='box',color=cq.Color(1,0,0)); a.add(cq.Workplane('XY').sphere(3),name='sphere',loc=cq.Location((20,0,0)),color=cq.Color(0,0,1)); a.export(sys.argv[1],exportType='STEP')", source],
  { windowsHide: true, timeout: 120000 });
  // Legal short STEP comments cross the old 50 MiB cap without complex geometry.
  const step = await readFile(source, "utf8");
  await writeFile(source, step.replace("END-ISO-10303-21;", ("/*" + " ".repeat(1020) + "*/\n").repeat(52 * 1024) + "END-ISO-10303-21;"));
  const original = await readFile(source);
  assert.equal(await isStepFile(source), true);
  const result = await modelVariants(source, directory);
  assert.equal(result.files.length, 1);
  const file = result.files[0], bytes = await readFile(file.path);
  assert.equal(file.role, "model");
  assert.equal(file.mimeType, "model/gltf-binary");
  assert.equal(file.width, undefined);
  assert.equal(file.size, bytes.length);
  assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  const doc = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  assert.ok(doc.meshes.length >= 2);
  assert.ok(doc.materials.length >= 2);
  assert.equal(JSON.stringify(doc).includes('"uri"'), false);
  assert.deepEqual(await readFile(source), original);
  // The cap applies before importing CAD libraries and cannot affect this runner.
  await promisify(execFile)(process.env.STEP_PYTHON_PATH, ["-I", "-c",
    "import runpy,sys; m=runpy.run_path(sys.argv[1]); m['constrain_process']();\ntry: bytearray(3*1024**3)\nexcept MemoryError: sys.exit(0)\nsys.exit(1)",
    fileURLToPath(new URL("../scripts/step-to-glb.py", import.meta.url))],
  { windowsHide: true, timeout: 15000 });
  await assert.rejects(modelVariants(source, directory), "existing outputs cannot be overwritten");
  const cancelledDirectory = join(directory, "cancelled");
  await mkdir(cancelledDirectory);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(modelVariants(source, cancelledDirectory, { signal: controller.signal }), /停止/);
  } finally { clearTimeout(timer); }
  assert.deepEqual(await readFile(source), original);
  const invalidDirectory = join(directory, "invalid");
  await mkdir(invalidDirectory);
  const invalid = join(invalidDirectory, "original");
  await writeFile(invalid, "ISO-10303-21;\nmalformed");
  await assert.rejects(modelVariants(invalid, invalidDirectory), /转换失败/);
  assert.equal(await readFile(invalid, "utf8"), "ISO-10303-21;\nmalformed");
});
