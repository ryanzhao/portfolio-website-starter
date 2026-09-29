import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("PC source download streams exact bytes, rejects truncation and never overwrites", async () => {
  const api = await import("../scripts/processor-download.mjs").catch(() => ({}));
  assert.equal(typeof api.downloadSource, "function");
  const dir = await mkdtemp(join(tmpdir(), "portfolio-download-"));
  const job = { assetId: crypto.randomUUID(), leaseToken: crypto.randomUUID() };
  const access = { clientId: `${"b".repeat(32)}.access`, clientSecret: `cfast_${"c".repeat(48)}` };
  const transport = async (url, init) => {
    assert.equal(url, "https://admin.example.test/api/processor");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers["CF-Access-Client-Id"], access.clientId);
    assert.equal(init.headers["CF-Access-Client-Secret"], access.clientSecret);
    assert.deepEqual(JSON.parse(init.body), { action: "source", ...job,offset:0,length:8*1024**2 });
    return new Response(new Uint8Array([1, 2, 3]), { status:206,headers: { "x-source-size":"3","content-range":"bytes 0-2/3" } });
  };
  const path = join(dir, "original");
  const options = { fetch: transport, access };
  assert.equal(await api.downloadSource("https://admin.example.test", "a".repeat(64), job, path, options), 3);
  assert.deepEqual(await readFile(path), Buffer.from([1, 2, 3]));
  assert.equal(await api.downloadSource("https://admin.example.test", "a".repeat(64), job, join(dir, "chunked"), {
    fetch: async () => new Response("abc", { status:206,headers: { "x-source-size": "3","content-range":"bytes 0-2/3" } }),
  }), 3);
  await assert.rejects(api.downloadSource("https://admin.example.test", "a".repeat(64), job, path, options));
  await assert.rejects(api.downloadSource("https://admin.example.test", "a".repeat(64), job, join(dir, "bad"), {
    fetch: async () => new Response("x", { status:206,headers: { "x-source-size":"2","content-range":"bytes 0-1/2" } }),
  }), /大小/);
  for (const [origin, credentials] of [["http://127.0.0.1", access], ["https://admin.example.test", { clientId: access.clientId }]]) {
    await assert.rejects(api.downloadSource(origin, "a".repeat(64), job, join(dir, "unsafe"), {
      access: credentials, fetch: () => assert.fail("unsafe credentials must not be sent"),
    }), /Access/);
  }
});

test('ranged downloads retry only the truncated chunk and preserve byte order',async()=>{
  const {downloadSource}=await import('../scripts/processor-download.mjs');
  const dir=await mkdtemp(join(tmpdir(),'portfolio-range-')),path=join(dir,'original'),size=8*1024**2+3,offsets=[];let interrupted=false;
  const result=await downloadSource('https://admin.example.test','a'.repeat(64),{assetId:crypto.randomUUID(),leaseToken:crypto.randomUUID()},path,{fetch:async(_url,init)=>{
    const {offset,length}=JSON.parse(init.body);offsets.push(offset);const count=Math.min(length,size-offset),cut=offset>0&&!interrupted; if(cut)interrupted=true;
    return new Response(Buffer.alloc(cut?1:count,offset?2:1),{status:206,headers:{'x-source-size':String(size),'content-range':`bytes ${offset}-${offset+count-1}/${size}`}});
  }});
  assert.equal(result,size);assert.deepEqual(offsets,[0,8*1024**2,8*1024**2]);const data=await readFile(path);assert.equal(data.length,size);assert.equal(data[0],1);assert.deepEqual([...data.subarray(-3)],[2,2,2]);
});
