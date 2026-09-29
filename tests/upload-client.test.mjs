import { test } from "node:test";
import assert from "node:assert/strict";

test("reselection resumes server receipts and rejects changed bytes beyond the uploaded prefix", async () => {
  const { uploadFile } = await import("../src/lib/upload-client.ts");
  const bytes = new Uint8Array(8388610), id = crypto.randomUUID();
  const file = new File([bytes], "resume.mp4", { type: "video/mp4" });
  let hashes, stopped = false;
  const receipts = [], puts = [], controller = new AbortController();
  const transport = async (url, init) => {
    if (url !== "/api/admin/uploads") {
      const part = Number(new URL(url).searchParams.get("partNumber")); puts.push(part);
      return new Response(null, { headers: { etag: `receipt-${part}` } });
    }
    const body = JSON.parse(init.body);
    if (body.action === "prepare") {
      if (hashes && JSON.stringify(hashes) !== JSON.stringify(body.hashes)) return Response.json({ error: "内容不一致" }, { status: 409 });
      hashes = body.hashes; return Response.json({ parts: receipts });
    }
    if (body.action === "receipt") { receipts.push({ partNumber: body.partNumber, etag: body.etag }); return Response.json({ saved: true }); }
    if (body.action === "part") {
      if (body.partNumber === 2 && !stopped) { stopped = true; controller.abort(); throw controller.signal.reason; }
      return Response.json({ url: `https://${"a".repeat(32)}.r2.cloudflarestorage.com/openmpd/originals/${id}?partNumber=${body.partNumber}`, method: "PUT", offset: (body.partNumber-1)*8388608, length: body.partNumber === 1 ? 8388608 : 2 });
    }
    return Response.json({ id, filename: file.name, mimeType: file.type, size: file.size, status: body.action === "complete" ? "processing_pending" : "uploading" });
  };
  await assert.rejects(uploadFile(file, id, { fetch: transport, signal: controller.signal }));
  assert.deepEqual(receipts, [{ partNumber: 1, etag: "receipt-1" }]);
  bytes[8388609] = 1;
  await assert.rejects(uploadFile(new File([bytes], file.name, { type: file.type }), id, { fetch: transport, resume: true }), /内容不一致/);
  assert.deepEqual(puts, [1]);
  const result = await uploadFile(new File([file], file.name, { type: file.type }), id, { fetch: transport, resume: true });
  assert.equal(result.status, "processing_pending");
  assert.deepEqual(puts, [1, 2]);
  const actions = [];
  const recovered = await uploadFile(file, id, { resume: true, fetch: async (url, init) => {
    assert.equal(url, "/api/admin/uploads");
    const body = JSON.parse(init.body); actions.push(body.action);
    return Response.json({ id, filename: file.name, mimeType: file.type, size: file.size, status: body.action === "read" ? "completing" : "processing_pending" });
  } });
  assert.equal(recovered.status, "processing_pending");
  assert.deepEqual(actions, ["read", "recover"]);
});

test("batch upload continues after one failure and stops before later files on abort", async () => {
  const api = await import("../src/lib/upload-client.ts");
  assert.equal(typeof api.uploadFiles, "function");
  const items = ["first", "bad", "last"].map(name => ({ id: crypto.randomUUID(), file: new File(["abc"], `${name}.png`, { type: "image/png" }) }));
  const began = [], results = [];
  const transport = async (url, options) => {
    if (url !== "/api/admin/uploads") return new Response(null, { headers: { etag: "receipt" } });
    const body = JSON.parse(options.body);
    if (body.action === "prepare") return Response.json({ parts: [] });
    if (body.action === "receipt") return Response.json({ saved: true });
    if (body.action === "begin") {
      began.push(body.id);
      if (body.id === items[1].id) return Response.json({ error: "bad file" }, { status: 400 });
    }
    if (body.action === "part") return Response.json({ url: `https://${"a".repeat(32)}.r2.cloudflarestorage.com/openmpd/originals/${body.id}?partNumber=1`, method: "PUT", offset: 0, length: 3 });
    return Response.json({ id: body.id, status: body.action === "complete" ? "processing_pending" : "uploading" });
  };
  await api.uploadFiles(items, { fetch: transport, onResult: (id, error) => results.push({ id, error }) });
  assert.deepEqual(began, items.map(item => item.id));
  assert.deepEqual(results, [{ id: items[0].id, error: null }, { id: items[1].id, error: "bad file" }, { id: items[2].id, error: null }]);
  const controller = new AbortController();
  let calls = 0;
  await api.uploadFiles(items, { signal: controller.signal, fetch: async () => {
    calls++; controller.abort(); throw controller.signal.reason;
  }, onResult: () => {} });
  assert.equal(calls, 1);
});

test("browser uploader slices bytes, sends no credentials to R2 and completes only acknowledged parts", async () => {
  const api = await import("../src/lib/upload-client.ts").catch(() => ({}));
  assert.equal(typeof api.uploadFile, "function");
  const file = new File([new Uint8Array(8388610)], "test.mp4", { type: "video/mp4" });
  const actions = [], lengths = [], progress = [];
  const id = crypto.randomUUID();
  const transport = async (url, options) => {
    if (url === "/api/admin/uploads") {
      const body = JSON.parse(options.body); actions.push(body);
      if (body.action === "prepare") return Response.json({ parts: [] });
      if (body.action === "receipt") return Response.json({ saved: true });
      assert.equal(options.credentials, "same-origin");
      if (body.action === "part") return Response.json({ url: `https://${"a".repeat(32)}.r2.cloudflarestorage.com/openmpd/originals/${id}?partNumber=${body.partNumber}`,
        method: "PUT", offset: (body.partNumber - 1) * 8388608, length: body.partNumber === 1 ? 8388608 : 2 });
      return Response.json({ id, status: body.action === "complete" ? "processing_pending" : "uploading" });
    }
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers, undefined);
    lengths.push(options.body.size);
    return new Response(null, { headers: { etag: `receipt-${lengths.length}` } });
  };
  const result = await api.uploadFile(file, id, { fetch: transport, onProgress: n => progress.push(n) });
  assert.equal(result.status, "processing_pending");
  assert.deepEqual(lengths, [8388608, 2]);
  assert.deepEqual(progress, [0, 8388608, file.size]);
  assert.deepEqual(actions.at(-1), { action: "complete", id, parts: [{ partNumber: 1, etag: "receipt-1" }, { partNumber: 2, etag: "receipt-2" }] });
  let completed = false;
  await assert.rejects(api.uploadFile(file, id, { fetch: async (url, options) => {
    if (url !== "/api/admin/uploads") return new Response(null);
    if (JSON.parse(options.body).action === "complete") completed = true;
    return transport(url, options);
  } }), /回执/);
  assert.equal(completed, false);
});

test("upload retries transient transfer and lost completion responses without duplicating parts", async () => {
  const { uploadFile } = await import("../src/lib/upload-client.ts");
  const file = new File(["abc"], "a.png", { type: "image/png" });
  const id = crypto.randomUUID();
  let puts = 0, completes = 0;
  const manifests = [];
  const transport = async (url, options) => {
    if (url !== "/api/admin/uploads") {
      if (++puts === 1) throw new TypeError("network unavailable");
      return new Response(null, { headers: { etag: "receipt" } });
    }
    const body = JSON.parse(options.body);
    if (body.action === "prepare") return Response.json({ parts: [] });
    if (body.action === "receipt") return Response.json({ saved: true });
    if (body.action === "part") return Response.json({ url: `https://${"a".repeat(32)}.r2.cloudflarestorage.com/openmpd/originals/${id}?partNumber=1`,
      method: "PUT", offset: 0, length: 3 });
    if (body.action === "complete") {
      manifests.push(body.parts);
      if (++completes === 1) throw new TypeError("response lost after commit");
    }
    return Response.json({ id, status: "processing_pending" });
  };
  await uploadFile(file, id, { fetch: transport });
  assert.equal(puts, 2);
  assert.equal(completes, 2);
  assert.deepEqual(manifests[0], manifests[1]);
  let denied = 0;
  await assert.rejects(uploadFile(file, id, { fetch: async () => {
    denied++; return Response.json({ error: "denied" }, { status: 403 });
  } }), /denied/);
  assert.equal(denied, 1);
  let failures = 0;
  await assert.rejects(uploadFile(file, id, { fetch: async () => {
    failures++; throw new TypeError("offline");
  } }), /offline/);
  assert.equal(failures, 3);
  const controller = new AbortController();
  let cancelledCalls = 0;
  await assert.rejects(uploadFile(file, id, { signal: controller.signal, fetch: async () => {
    cancelledCalls++; controller.abort(); throw controller.signal.reason;
  } }), { name: "AbortError" });
  assert.equal(cancelledCalls, 1);
});

test("STEP browser MIME is normalized by matching extension for begin and resume only", async () => {
  const {uploadFile, uploadMimeType} = await import("../src/lib/upload-client.ts");
  for (const type of ["", "application/octet-stream", "model/step"]) assert.equal(uploadMimeType({name:"Assembly.STP",type}),"model/step");
  assert.equal(uploadMimeType({name:"picture.png",type:"application/octet-stream"}),"application/octet-stream");
  assert.equal(uploadMimeType({name:"shape.step",type:"image/png"}),"image/png");
  const file=new File(["ISO-10303-21;"],"shape.step"),id=crypto.randomUUID();
  let begin;
  await assert.rejects(uploadFile(file,id,{fetch:async(_,init)=>{begin=JSON.parse(init.body);return Response.json({error:"stop before transfer"},{status:400});}}),/stop before transfer/);
  assert.equal(begin.file.mimeType,"model/step");
  const result=await uploadFile(file,id,{resume:true,fetch:async()=>Response.json({filename:file.name,mimeType:"model/step",size:file.size,status:"processing_pending"})});
  assert.equal(result.status,"processing_pending");
});
