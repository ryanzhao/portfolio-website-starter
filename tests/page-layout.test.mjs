import { test } from 'node:test';
import assert from 'node:assert/strict';

test('layout schema rejects unknown fields, invalid geometry, and excessive text; mobile keeps typography only', async () => {
  const {validatePageLayout, resolveElement, emptyPageLayout} = await import('../src/lib/page-layout.ts');
  assert.deepEqual(emptyPageLayout(), {schemaVersion:1,blocks:{}});
  const layout={schemaVersion:1,blocks:{hero:{elements:{title:{x:20,width:60,text:'<script>alert(1)</script>',font:'garet',fontSize:40}}}}};
  assert.deepEqual(validatePageLayout(layout),layout);
  assert.deepEqual(resolveElement(layout,'hero','title','mobile'),{text:'<script>alert(1)</script>',font:'garet',fontSize:40});
  for(const entry of [{fontSize:NaN},{x:99,width:10},{color:'red'},{url:'https://evil.test'},{text:'a'.repeat(2001)}]) {
    assert.throws(()=>validatePageLayout({schemaVersion:1,blocks:{hero:{elements:{title:entry}}}}));
  }
  assert.throws(()=>validatePageLayout({schemaVersion:1,blocks:{unknown:{elements:{}}}}));
  assert.throws(()=>validatePageLayout(JSON.parse('{"schemaVersion":1,"blocks":{"hero":{"elements":{"__proto__":{}}}}}')));
  assert.throws(()=>validatePageLayout({schemaVersion:1,blocks:{hero:{elements:{unknown:{text:'ignored'}}}}}));
  const added=Object.fromEntries(Array.from({length:21},()=>[`text-${crypto.randomUUID()}`,{text:'new'}]));
  assert.throws(()=>validatePageLayout({schemaVersion:1,blocks:{hero:{elements:added}}}));
  const override=structuredClone(layout);override.blocks.hero.overrides={mobile:{elements:{title:{x:5,width:90,fontSize:22}}}};
  assert.equal(resolveElement(override,'hero','title','mobile').width,90);
  assert.equal(resolveElement(override,'hero','title','tablet').width,undefined);
});
