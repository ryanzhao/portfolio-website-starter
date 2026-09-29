import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectFont, fontByteLimit } from '../src/lib/designer/font-format.ts';
import { saveFont, fontBytes, publishFont } from '../src/lib/designer/fonts.ts';
import { beginUpload } from '../src/lib/uploads.ts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('WOFF2 parsing accepts installed real font and rejects disguises, truncation, trailing data and expansion bombs', async () => {
  const valid = await readFile(new URL('../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2', import.meta.url));
  assert.equal(inspectFont(valid).family, 'Geist');
  for (const bad of [Buffer.from('<script>alert(1)</script>'), valid.subarray(0, 70), Buffer.alloc(fontByteLimit + 1)]) assert.throws(() => inspectFont(bad));
  const bomb = Buffer.from(valid); bomb.writeUInt32BE(0xffffffff,16); assert.throws(()=>inspectFont(bomb));
  const appended = Buffer.concat([valid, Buffer.from('junk')]); appended.writeUInt32BE(appended.length,8); assert.throws(()=>inspectFont(appended));
  const corrupt = Buffer.from(valid); corrupt.fill(0,120,160); assert.throws(()=>inspectFont(corrupt));
});

test('font and media atomically share quota; originals stay private until verified explicit publication',async()=>{
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,cf:false,compatibilityDate:'2026-09-19',script:'export default {fetch(){return new Response(null)}}',r2Buckets:['ORIGINALS','PUBLISHED','BACKUPS'],d1Databases:['UPLOADS']}));
  try{
    const db=await runtime.getD1Database('UPLOADS');
    for(const file of ['0001_uploads.sql','0002_upload_completion.sql','0009_designer_fonts.sql']){const sql=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');await db.batch(sql.split(';').map(v=>v.trim()).filter(Boolean).map(v=>db.prepare(v)));}
    const storage={UPLOADS:db,ORIGINALS:await runtime.getR2Bucket('ORIGINALS'),PUBLISHED:await runtime.getR2Bucket('PUBLISHED'),BACKUPS:await runtime.getR2Bucket('BACKUPS')};
    const bytes=await readFile(new URL('../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2',import.meta.url));
    const id=crypto.randomUUID();const font=await saveFont(storage,'owner',id,bytes,400,'normal',bytes.length);
    assert.equal(font.status,'ready');assert.equal((await storage.PUBLISHED.list()).objects.length,0);
    assert.equal((await saveFont(storage,'owner',id,bytes,400,'normal',bytes.length)).id,id);
    await assert.rejects(()=>fontBytes(storage,'other',id),e=>e.status===404);
    await assert.rejects(()=>beginUpload(db,storage.ORIGINALS,'owner',crypto.randomUUID(),{filename:'a.png',mimeType:'image/png',size:1},bytes.length),e=>e.status===413);
    await assert.rejects(()=>saveFont(storage,'owner',crypto.randomUUID(),bytes,400,'normal',bytes.length),e=>e.status===413);
    assert.equal((await publishFont(storage,'owner',id)).status,'published');
    assert.equal((await storage.BACKUPS.list()).objects.length,1);assert.equal((await storage.ORIGINALS.list()).objects.length,1);
    assert.deepEqual(Buffer.from(await (await storage.PUBLISHED.get(`fonts/${font.sha256}.woff2`)).arrayBuffer()),bytes);
  }finally{await runtime.dispose();}
});
