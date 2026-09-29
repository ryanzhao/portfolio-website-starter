import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateModelGlb, MAX_MODEL_BYTES } from '../src/lib/model-glb.ts';
import { validateProcessingResult, publicMediaVariants } from '../src/lib/processing-result.ts';
import { verifyDerivative } from '../src/lib/derivative-verification.ts';

function glb(change = () => {}, binaryChange = () => {}, binaryLength = 36) {
  const doc = {asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
  change(doc);
  const json = Buffer.from(JSON.stringify(doc)), jsonLength = Math.ceil(json.length / 4) * 4;
  const output = Buffer.alloc(28 + jsonLength + binaryLength);
  output.writeUInt32LE(0x46546c67,0); output.writeUInt32LE(2,4); output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(jsonLength,12);output.writeUInt32LE(0x4e4f534a,16);output.fill(32,20,20+jsonLength);json.copy(output,20);
  output.writeUInt32LE(binaryLength,20+jsonLength);output.writeUInt32LE(0x004e4942,24+jsonLength);
  [0,0,0,1,0,0,0,1,0].forEach((value,index)=>output.writeFloatLE(value,28+jsonLength+index*4));
  binaryChange(output,28+jsonLength);
  return output;
}

test('GLB validates embedded triangles and rejects unsafe structure and geometry',()=>{
  assert.doesNotThrow(()=>validateModelGlb(glb()));
  for (const change of [d=>d.buffers[0].uri='https://example.com/private',d=>d.images=[{uri:'data:image/png;base64,x'}],d=>d.extensionsUsed=['KHR_draco_mesh_compression'],d=>d.accessors[0].count=6000001,d=>d.accessors[0].byteOffset=36,d=>d.nodes[0].children=[0],d=>d.meshes[0].primitives[0].mode=1,d=>d.nodes[0].matrix=[1],d=>d.scenes[0].nodes=[4],d=>d.scenes[0].nodes=[],d=>d.nodes[0].scale=[1e300,1e300,1e300],d=>d.nodes[0].translation=[1e300,0,0],d=>d.nodes[0].rotation=[1,1,1,1],d=>d.nodes[0].matrix=[2,0,0,0,0,2,0,0,0,0,2,0,0,0,0,1]]) assert.throws(()=>validateModelGlb(glb(change)));
  assert.throws(()=>validateModelGlb(glb(()=>{},(b,offset)=>b.writeFloatLE(NaN,offset))));
  assert.throws(()=>validateModelGlb(glb(()=>{},b=>b.writeUInt32LE(b.length-1,8))));
  assert.throws(()=>validateModelGlb(new Uint8Array(MAX_MODEL_BYTES+1)));
  assert.throws(()=>validateModelGlb(glb(d=>{d.accessors=Array.from({length:100001},()=>d.accessors[0]);})));
  assert.throws(()=>validateModelGlb(glb(d=>{d.meshes[0].primitives=Array.from({length:100001},()=>({attributes:{POSITION:0}}));})));
  assert.throws(()=>validateModelGlb(glb(d=>{
    d.buffers[0].byteLength=36000;d.bufferViews[0].byteLength=36000;d.accessors[0].count=3000;
    d.accessors=Array.from({length:3000},()=>d.accessors[0]);
  },()=>{},36000)));
  assert.throws(()=>validateModelGlb(glb(d=>{
    d.buffers[0].byteLength=36000;d.bufferViews[0].byteLength=36000;d.accessors[0].count=3000;
    d.meshes[0].primitives=Array.from({length:2001},()=>({attributes:{POSITION:0}}));
  },()=>{},36000)));
});

test('model declarations require one GLB with no image or duration metadata',()=>{
  const id=crypto.randomUUID(), file={role:'model',mimeType:'model/gltf-binary',size:100,sha256:'a'.repeat(64)};
  const result=validateProcessingResult(id,'model',{files:[file]});
  assert.equal(result.files[0].key,`derivatives/${id}/${file.sha256}/model.glb`);
  assert.equal('width' in result.files[0],false);
  assert.deepEqual(publicMediaVariants(id,'model',result.files),result.files);
  for(const files of [[file,file],[{...file,width:1}],[{...file,duration:1}],[{...file,mimeType:'model/step'}],[{...file,size:MAX_MODEL_BYTES+1}],[{...file,role:'detail'}]]) assert.throws(()=>validateProcessingResult(id,'model',{files}));
});

test('stored GLB requires exact hash, format, path, and stable storage version',async()=>{
  const bytes=glb(),sha256=createHash('sha256').update(bytes).digest('hex'),key=`derivatives/${crypto.randomUUID()}/${sha256}/model.glb`;
  const file={key,sha256,size:bytes.length,mimeType:'model/gltf-binary'};
  const bucket={get:async()=>({size:bytes.length,version:'v1',etag:'e1',body:new ReadableStream({start(c){c.enqueue(bytes.subarray(0,22));c.enqueue(bytes.subarray(22));c.close();}})}),head:async()=>({version:'v1'})};
  assert.equal((await verifyDerivative(bucket,file)).version,'v1');
  for(const patch of [{sha256:'a'.repeat(64)},{mimeType:'image/webp'},{key:key.replace('model.glb','detail.glb')},{size:MAX_MODEL_BYTES+1}]) await assert.rejects(verifyDerivative(bucket,{...file,...patch}));
  await assert.rejects(verifyDerivative({...bucket,head:async()=>({version:'v2'})},file));
});
