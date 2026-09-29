import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUpload } from '../src/lib/media.ts';
import { inspectStoredUpload } from '../src/lib/media-inspection.ts';
import { uploadMimeType, MEDIA_UPLOAD_ACCEPT } from '../src/lib/upload-client.ts';

test('GLB upload normalizes MIME, bounds size and rejects forged headers', async () => {
  assert.ok(MEDIA_UPLOAD_ACCEPT.includes('.glb'));
  assert.equal(uploadMimeType({name:'model.GLB',type:''}), 'model/gltf-binary');
  const input={filename:'model.glb',mimeType:'model/gltf-binary',size:32};
  assert.equal(validateUpload(input).kind,'model');
  assert.throws(()=>validateUpload({...input,size:50*1024**2+1}));
  assert.throws(()=>validateUpload({...input,filename:'model.step'}));
  const bytes=Buffer.alloc(32);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(32,8);
  assert.equal((await inspectStoredUpload(input,32,bytes)).processingStatus,'processing_pending');
  bytes.writeUInt32LE(31,8);
  await assert.rejects(inspectStoredUpload(input,32,bytes));
  await assert.rejects(inspectStoredUpload(input,32,new Uint8Array(2)));
});
