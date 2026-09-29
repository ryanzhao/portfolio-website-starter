import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { writePlacementSnapshot, readPlacementSnapshot } from '../src/lib/placement-snapshot.ts';

test('recovery preserves current draft, validates media and never changes public content', async () => {
  const api = await import('../src/lib/placement-recovery.ts').catch(() => ({}));
  assert.equal(typeof api.restorePlacementDraft, 'function');
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
    compatibilityDate: '2026-09-18', script: 'export default {fetch(){return new Response(null)}}',
    r2Buckets: ['ORIGINALS', 'BACKUPS'], d1Databases: ['UPLOADS'] }));
  try {
    const UPLOADS = await runtime.getD1Database('UPLOADS'), ORIGINALS = await runtime.getR2Bucket('ORIGINALS'), BACKUPS = await runtime.getR2Bucket('BACKUPS');
    for (const name of ['0001_uploads.sql','0002_upload_completion.sql','0003_processing.sql','0004_processing_result.sql','0005_processing_verified.sql']) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
      await UPLOADS.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>UPLOADS.prepare(s)));
    }
    for (const kind of ['image','video']) {
      const id = crypto.randomUUID(), slotId = 'home.advanced-rockets-engines';
      await UPLOADS.prepare(`INSERT INTO upload_sessions (id,owner,filename,mimeType,size,kind,objectKey,status,createdAt,expiresAt,storageVersion,storageEtag)
        VALUES (?,'owner','fixture','test',3,?,?,'processing_pending',1,2,'version','etag')`).bind(id,kind,`originals/${id}`).run();
      const files = [], verified = [];
      for (const role of kind === 'image' ? ['thumbnail','detail'] : ['poster','video']) {
        const key = `derivatives/${id}/${"a".repeat(64)}/${role}.${role === "video" ? "mp4" : "webp"}`;
        const object = await ORIGINALS.put(key,'abc');
        files.push({ key,role,sha256:'a'.repeat(64),size:3,mimeType:role === 'video' ? 'video/mp4' : 'image/webp',width:1,height:1 });
        verified.push({key,version:object.version,etag:object.etag});
      }
      await UPLOADS.prepare(`INSERT INTO processing_jobs (assetId,status,createdAt,resultManifest,verifiedObjects) VALUES (?,'ready',1,?,?)`).bind(id,JSON.stringify({files}),JSON.stringify(verified)).run();
      const historical = {revision:'old',kind,placement:{slotId,assetId:id,alt:'Historical',caption:''}};
      const snapshot = await writePlacementSnapshot(BACKUPS,historical,null);
      const current = {...historical.placement,alt:'Current unpublished edits'};
      let document = {...current,_rev:'current'}, mutations = 0;
      const publicDocument = Object.freeze({...historical.placement,_rev:'live'});
      const client = {getDocument:async key=>key.startsWith('drafts.') ? document : publicDocument,
        mutate:async values=>{
          mutations++;
          assert.equal(values.length,1);
          const patch = values[0].patch;
          assert.equal(patch.id,`drafts.placement-${slotId}`);
          assert.equal(patch.ifRevisionID,document._rev);
          document = {...patch.set,_rev:'restored'};
          return {transactionId:'local-only'};
        }};
      const input = {snapshotId:snapshot.sha256,version:snapshot.version,side:'candidate',slotId,revision:'current',confirmed:true};
      assert.equal(typeof api.readPlacementHistory,'function');
      const history = await api.readPlacementHistory({UPLOADS,ORIGINALS,BACKUPS},client,'owner',slotId);
      assert.ok(history.items.some(item=>item.id===snapshot.sha256));
      assert.deepEqual(history.current.placement,current);
      await assert.rejects(api.readPlacementHistory({UPLOADS,ORIGINALS,BACKUPS},client,'other',slotId),{status:404});
      const selection = await api.readPlacementHistory({UPLOADS,ORIGINALS,BACKUPS},client,'owner',slotId,undefined,snapshot.sha256);
      assert.equal(selection.items[0].candidate.placement.alt,'Historical');
      for (const override of [{confirmed:false},{revision:'outdated'},{version:'changed'},{side:'previous'}]) {
        await assert.rejects(api.restorePlacementDraft({UPLOADS,ORIGINALS,BACKUPS},client,'owner',{...input,...override}));
      }
      await assert.rejects(api.restorePlacementDraft({UPLOADS,ORIGINALS,BACKUPS},client,'other',input));
      const brokenBackup = { get: (...args)=>BACKUPS.get(...args), head:(...args)=>BACKUPS.head(...args), put:async()=>{throw new Error('backup offline');} };
      await assert.rejects(api.restorePlacementDraft({UPLOADS,ORIGINALS,BACKUPS:brokenBackup},client,'owner',input));
      assert.equal(mutations,0);
      const result = await api.restorePlacementDraft({UPLOADS,ORIGINALS,BACKUPS},client,'owner',input);
      assert.equal(result.published,false);
      assert.equal(document.alt,'Historical');
      assert.equal(publicDocument._rev,'live');
      assert.deepEqual((await readPlacementSnapshot(BACKUPS,result.preservedSnapshot)).candidate.placement,current);
      const audit = await (await BACKUPS.get(`operations/restores/${result.operationId}/result.json`)).json();
      assert.equal(audit.status,'succeeded');
      assert.equal(audit.owner,'owner');
      document = {...current,_rev:'current'};
      for (const [statusCode,expectedStatus] of [[409,'conflict'],[503,'unknown']]) {
        const failingClient = { ...client, mutate: async()=>{ throw Object.assign(new Error('synthetic failure'),{statusCode}); } };
        const before = new Set((await BACKUPS.list({prefix:'operations/restores/'})).objects.map(o=>o.key));
        await assert.rejects(api.restorePlacementDraft({UPLOADS,ORIGINALS,BACKUPS},failingClient,'owner',input), {status:statusCode});
        const outcome = (await BACKUPS.list({prefix:'operations/restores/'})).objects.find(o=>!before.has(o.key) && o.key.endsWith('/result.json'));
        assert.equal((await (await BACKUPS.get(outcome.key)).json()).status,expectedStatus);
        assert.equal(document.alt,current.alt);
      }
      await ORIGINALS.put(files[0].key,'changed');
      await assert.rejects(api.restorePlacementDraft({UPLOADS,ORIGINALS,BACKUPS},client,'owner',input));
      assert.equal(mutations,1);
    }
  } finally { await runtime.dispose(); }
});
