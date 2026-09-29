import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { tmpdir } from "node:os";

const exec = promisify(execFile);
test("PC processor entry validates configuration and processes an empty queue once", async () => {
  const env = { ...process.env, PROCESSOR_ORIGIN: "", PROCESSOR_TOKEN: "", PROCESSOR_WORK_DIR: "", CF_ACCESS_CLIENT_ID: "", CF_ACCESS_CLIENT_SECRET: "" };
  const run = (args, extra = {}) => exec(process.execPath, ["scripts/process-media.mjs", ...args], { env: { ...env, ...extra }, timeout: 15000 });
  assert.match((await run(["--help"])).stdout, /--once.*--watch/s);
  await assert.rejects(run(["--once"]), error => error.code === 1 && /PROCESSOR_ORIGIN/.test(error.stderr));
  await assert.rejects(run(["--token", "secret-example"]), error => !error.stderr.includes("secret-example"));
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests++;
    assert.equal(request.headers.authorization, `Bearer ${"a".repeat(64)}`);
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), { action: "claim" });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ job: null }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await run(["--once"], { PROCESSOR_ORIGIN: `http://127.0.0.1:${server.address().port}`, PROCESSOR_TOKEN: "a".repeat(64), PROCESSOR_WORK_DIR: tmpdir() });
    assert.match(result.stdout, /没有待处理任务/);
    assert.equal(requests, 1);
    assert.ok(!result.stdout.includes("a".repeat(64)));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('watch remains available for owner retry after a transient service failure',async()=>{
  const {spawn}=await import('node:child_process');
  const {once}=await import('node:events');
  const server=createServer((req,res)=>{req.resume();res.writeHead(503);res.end();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const child=spawn(process.execPath,['scripts/process-media.mjs','--watch'],{windowsHide:true,env:{...process.env,PROCESSOR_ORIGIN:`http://127.0.0.1:${server.address().port}`,PROCESSOR_TOKEN:'a'.repeat(64),PROCESSOR_WORK_DIR:tmpdir(),CF_ACCESS_CLIENT_ID:'',CF_ACCESS_CLIENT_SECRET:''}});
  let text='';
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('watch did not report failure')),10000);
      child.stderr.on('data',data=>{text+=data;if(text.includes('30 秒')){clearTimeout(timer);resolve();}});
      child.on('error',reject);
    });
    assert.equal(child.exitCode,null);assert.doesNotMatch(text,/a{64}/);
  }finally{const ended=once(child,'exit');child.kill();await ended;await new Promise(r=>server.close(r));}
});
