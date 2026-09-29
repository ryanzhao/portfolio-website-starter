import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSite } from '../src/lib/designer/defaults.ts';
import { validatePage, validateSite, resolveStyle, resolveLink, isSafePath, isSafeExternalLink, createId } from '../src/lib/designer/model.ts';
import { createElement, createBlock, copyPage, groupElements, ungroupElements, resolveGroup, moveElements, scaleElements, alignElements, transferElements, recyclePage, createHistory, pushHistory, undo, redo } from '../src/lib/designer/operations.ts';

test('default site is deterministic, typed, contains every media slot and preserved source text', async()=>{
 const site=createDefaultSite();assert.deepEqual(site,createDefaultSite());assert.equal(site.pages.length,16);
 const {mediaSlots}=await import('../src/lib/media.ts');const elements=site.pages.flatMap(p=>p.blocks.flatMap(b=>b.elements));for(const slot of mediaSlots)assert.ok(elements.some(e=>e.legacySlot===slot.id),slot.id);
 assert.ok(elements.some(e=>e.text==='Ryan Zhao’s Portfolio'));assert.ok(elements.some(e=>e.type==='cad'));assert.ok(elements.some(e=>e.type==='project-list'));assert.deepEqual(validateSite(site),site);
});
test('legacy migration is pure, deterministic and preserves new texts, viewport style and image IDs',()=>{
 const key=`text-${crypto.randomUUID()}`;const old={schemaVersion:1,blocks:{hero:{height:900,elements:{title:{text:'保存的标题',fontSize:64,x:20},[key]:{text:'额外文字',color:'#fff'},'media:home.hero':{fit:'contain'}},overrides:{tablet:{elements:{title:{text:'平板标题'}}},mobile:{height:700,elements:{title:{text:'手机标题',fontSize:22,x:0,hidden:true}}}}}}};const before=structuredClone(old);const site=createDefaultSite(old),hero=site.pages[0].blocks[0];
 assert.equal(hero.elements.find(e=>e.id==='hero-title').text,'保存的标题');assert.equal(hero.elements.find(e=>e.id==='hero-title').styles.mobile.hidden,true);assert.equal(hero.elements.find(e=>e.id===`hero-${key}`).text,'额外文字');assert.equal(hero.elements.find(e=>e.legacySlot==='home.hero').styles.desktop.fit,'contain');assert.equal(hero.styles.mobile.height,700);assert.deepEqual(old,before);assert.deepEqual(site,createDefaultSite(old));
 assert.deepEqual(hero.elements.find(e=>e.id==='hero-title').textOverrides,{tablet:'平板标题',mobile:'手机标题'});
});
test('cross-block transfer preserves relative geometry and complete groups, dissolves partial singleton groups',()=>{
 const page=createDefaultSite().pages[0],source=createBlock(),target=createBlock();source.elements=[{...createElement(),groupId:'moving-group',styles:{desktop:{x:10,y:10,width:10}}},{...createElement(),groupId:'moving-group',styles:{desktop:{x:30,y:20,width:10}}}];page.blocks=[source,target];
 const together=transferElements(page,source.id,target.id,source.elements.map(e=>e.id),{x:5,y:6});assert.deepEqual(together.blocks[1].elements.map(e=>[e.styles.desktop.x,e.styles.desktop.y]),[[5,6],[25,16]]);assert.ok(together.blocks[1].elements.every(e=>e.groupId==='moving-group'));
 const partial=transferElements(page,source.id,target.id,[source.elements[0].id],{x:5,y:6});assert.equal(partial.blocks[0].elements[0].groupId,undefined);assert.equal(partial.blocks[1].elements[0].groupId,undefined);assert.equal(page.blocks[0].elements.length,2);
});
test('strict trust boundary rejects arbitrary properties, CSS, URLs, IDs and routes',()=>{
 for(const mutate of [s=>s.unknown=true,s=>s.pages[0].blocks[0].elements[0].styles.desktop.background='url(https://evil.test)',s=>s.pages[0].blocks[0].elements[0].styles.desktop.width=Infinity,s=>s.pages[0].blocks[0].elements[0].text='x'.repeat(2001),s=>s.pages[0].blocks[0].elements[0].role='onclick',s=>s.pages[0].blocks[0].elements[0].link={external:'javascript:alert(1)'},s=>s.pages[0].blocks[0].elements[0].styles.desktop.font='made-up',s=>s.pages[0].blocks[0].elements[0].id=s.pages[1].blocks[0].elements[0].id,s=>s.pages[1].path='/admin/foo',s=>s.pages[1].redirectFrom=['/'],s=>s.pages[0].deleted=true]){const site=createDefaultSite();mutate(site);assert.throws(()=>validateSite(site));}
 for(const path of ['/api','/admin/login','/_next/static','/models/foo','//evil','/a/../b','/a%2fb','/A','/a?x=1'])assert.equal(isSafePath(path),false,path);
 assert.equal(isSafeExternalLink('https://example.com/a'),true);assert.equal(isSafeExternalLink('https://user:secret@example.com'),false);assert.equal(isSafeExternalLink('mailto:owner@example.com'),true);
 const site=createDefaultSite();site.pages[0].blocks[0].elements[0].styles.desktop=JSON.parse('{"__proto__":{}}');assert.throws(()=>validateSite(site));
});
test('geometry may exceed page for draft correction; narrow views inherit typography but not coordinates',()=>{
 const style={desktop:{x:90,y:20,width:50,fontSize:40,color:'#fff'},mobile:{x:5,width:90,fontSize:20}};assert.deepEqual(resolveStyle(style,'tablet'),{fontSize:40,color:'#fff'});assert.equal(resolveStyle(style,'mobile').width,90);
 const site=createDefaultSite();site.pages[0].blocks[0].elements[0].styles=style;assert.doesNotThrow(()=>validateSite(site));
 const target=site.pages[1];assert.equal(resolveLink(site,{pageId:target.id}),target.path);target.path='/renamed';assert.equal(resolveLink(site,{pageId:target.id,anchor:'title'}),'/renamed#title');target.deleted=true;assert.equal(resolveLink(site,{pageId:target.id}),undefined);
});
test('capacity boundaries include recycled objects and exact serialized UTF-8 budget',()=>{
 const site=createDefaultSite(),page=structuredClone(site.pages[2]);page.blocks=Array.from({length:5},()=>({...createBlock(),elements:Array.from({length:100},()=>createElement())}));assert.doesNotThrow(()=>validatePage(page));page.blocks[0].elements.push(createElement());assert.throws(()=>validatePage(page));page.blocks[0].elements.pop();page.blocks.push({...createBlock(),elements:[createElement()]});assert.throws(()=>validatePage(page));
 page.blocks.pop();for(const block of page.blocks)for(const element of block.elements)element.text='中'.repeat(2000);assert.throws(()=>validatePage(page));
 const max=createDefaultSite();while(max.pages.length<100)max.pages.push({...copyPage(max.pages[1],`/test-${max.pages.length}`),blocks:[]});assert.doesNotThrow(()=>validateSite(max));max.pages.push({...copyPage(max.pages[1],'/too-many'),blocks:[]});assert.throws(()=>validateSite(max));max.pages.at(-1).deleted=true;assert.doesNotThrow(()=>validateSite(max));
 const grouped=structuredClone(site.pages[1]);grouped.blocks=[{...createBlock(),elements:Array.from({length:50},()=>({...createElement(),groupId:'group-limit'}))}];assert.doesNotThrow(()=>validatePage(grouped));grouped.blocks[0].elements.push({...createElement(),groupId:'group-limit'});assert.throws(()=>validatePage(grouped));grouped.blocks[0].elements.pop();grouped.blocks.push({...createBlock(),elements:[{...createElement(),groupId:'group-limit'}]});assert.throws(()=>validatePage(grouped));
});
test('copy, group, resize, align, transfer and history preserve identities and media semantics',()=>{
 let block=createBlock();block.elements=Array.from({length:3},(_,i)=>({...createElement('image'),assetId:crypto.randomUUID(),styles:{desktop:{x:i*20,y:i*10,width:10,height:10}}}));const ids=block.elements.map(e=>e.id);block=groupElements(block,ids);assert.equal(new Set(block.elements.map(e=>e.groupId)).size,1);block=moveElements(block,ids,2,3,'desktop');assert.equal(block.elements[0].styles.desktop.x,2);block=scaleElements(block,ids,2,'desktop');assert.equal(block.elements[1].styles.desktop.x,42);block=alignElements(block,ids,'top','desktop');assert.equal(new Set(block.elements.map(e=>e.styles.desktop.y)).size,1);block=ungroupElements(block,[block.elements[0].groupId]);assert.ok(block.elements.every(e=>!e.groupId));
 const page=createDefaultSite().pages[0];page.blocks=[block,createBlock()];const copy=copyPage(page,'/copy');assert.notEqual(copy.blocks[0].elements[0].id,ids[0]);assert.equal(copy.blocks[0].elements[0].assetId,block.elements[0].assetId);const moved=transferElements(page,block.id,page.blocks[1].id,[ids[0]],{x:5,y:6});assert.equal(moved.blocks[1].elements[0].id,ids[0]);assert.equal(page.blocks[1].elements.length,0);assert.throws(()=>recyclePage(page));
 let h=createHistory(0);for(let i=1;i<=101;i++)h=pushHistory(h,i);assert.equal(h.past.length,100);h=undo(h);assert.equal(h.present,100);h=redo(h);assert.equal(h.present,101);assert.equal(pushHistory(h,101),h);assert.match(createId(),/^element-/);
});
test('copy excludes recycled descendants; buttons scale; narrow grouping stays independent',()=>{
 const page=createDefaultSite().pages[0];page.blocks[0].elements[0].deleted=true;page.blocks[1].deleted=true;const copy=copyPage(page,'/copy');assert.equal(copy.blocks.length,page.blocks.length-1);assert.equal(copy.blocks[0].elements.length,page.blocks[0].elements.length-1);
 let b=createBlock();b.elements=[createElement('button'),createElement('text')];b=groupElements(b,b.elements.map(e=>e.id));const desktop=resolveGroup(b.elements[0]);b=ungroupElements(b,[desktop],'mobile');assert.equal(resolveGroup(b.elements[0]),desktop);assert.equal(resolveGroup(b.elements[0],'mobile'),undefined);assert.equal(resolveGroup(b.elements[0],'tablet'),desktop);b=scaleElements(b,b.elements.map(e=>e.id),2,'desktop');assert.equal(b.elements[0].styles.desktop.fontSize,48);assert.throws(()=>scaleElements(b,b.elements.map(e=>e.id),4,'desktop'));
 page.blocks=[b,createBlock()];const transferred=transferElements(page,b.id,page.blocks[1].id,b.elements.map(e=>e.id),{x:0,y:0},'desktop',{sourceWidth:1000,sourceHeight:500,targetWidth:500,targetHeight:1000});assert.equal(transferred.blocks[1].elements[0].styles.desktop.width,b.elements[0].styles.desktop.width*2);
});
test('bounded media backgrounds, posters, packaged icons, spacing and shared labels',()=>{
 const site=createDefaultSite();site.theme.contentWidth=1200;site.pages[0].blocks[0].styles.desktop={backgroundAssetId:crypto.randomUUID(),marginTop:10,marginBottom:20};const element=site.pages[0].blocks[0].elements[0];element.posterAssetId=crypto.randomUUID();element.icon='star';assert.doesNotThrow(()=>validateSite(site));element.icon='<svg onload=evil>';assert.throws(()=>validateSite(site));element.icon='star';site.pages[0].blocks[0].styles.desktop.backgroundAssetId='https://private-original';assert.throws(()=>validateSite(site));assert.ok(site.footer.blocks[0].elements.some(e=>e.role==='media-empty'));assert.ok(site.footer.blocks[0].elements.some(e=>e.role==='media-crop-warning'));
});
test('mobile-only legacy text remains absent on desktop and tablet',()=>{
 const key=`text-${crypto.randomUUID()}`,site=createDefaultSite({schemaVersion:1,blocks:{hero:{elements:{},overrides:{mobile:{elements:{[key]:{text:'手机专用'}}}}}}});const element=site.pages[0].blocks[0].elements.find(e=>e.id===`hero-${key}`);assert.equal(element.text,'');assert.equal(element.textOverrides.mobile,'手机专用');assert.equal(resolveStyle(element.styles,'desktop').hidden,true);assert.equal(resolveStyle(element.styles,'tablet').hidden,true);assert.equal(resolveStyle(element.styles,'mobile').hidden,false);
});
test('transfer snapshots inherited narrow groups before removing partial desktop groups',()=>{
 const page=createDefaultSite().pages[0],source=createBlock(),target=createBlock();source.elements=Array.from({length:3},()=>({...createElement(),groupId:'same-group'}));source.elements[2].groupOverrides={mobile:null};page.blocks=[source,target];const result=transferElements(page,source.id,target.id,source.elements.slice(0,2).map(e=>e.id));assert.ok(result.blocks[1].elements.every(e=>resolveGroup(e,'desktop')===undefined));assert.ok(result.blocks[1].elements.every(e=>resolveGroup(e,'mobile')==='same-group'));assert.ok(result.blocks[1].elements.every(e=>resolveGroup(e,'tablet')===undefined));assert.equal(resolveGroup(result.blocks[0].elements[0],'mobile'),undefined);
});
test('201 total pages with 100 active remain valid; component paths remain reserved',()=>{
 const site=createDefaultSite();while(site.pages.length<201)site.pages.push({...copyPage(site.pages[1],`/page-${site.pages.length}`),deleted:site.pages.length>=100,blocks:[]});assert.equal(site.pages.filter(p=>!p.deleted).length,100);assert.doesNotThrow(()=>validateSite(site));site.pages.at(-1).deleted=false;assert.throws(()=>validateSite(site));site.pages.at(-1).deleted=true;site.pages[1].path='/global-header';site.header.path='/renamed-header';assert.throws(()=>validateSite(site));
});
test('legacy project placeholders and dynamic count labels are editable source records',()=>{
 const site=createDefaultSite();for(const page of site.pages.filter(p=>p.path.startsWith('/projects/'))){const image=page.blocks.flatMap(b=>b.elements).find(e=>e.role==='project-placeholder');assert.equal(image.type,'image');assert.ok(image.alt.endsWith(': real project photograph pending'));}
 const elements=[site.footer,...site.pages].flatMap(p=>p.blocks.flatMap(b=>b.elements));for(const [role,value] of [['project-image-label','PROJECT IMAGE / PENDING'],['project-draft','Draft'],['filter-project','project'],['filter-projects','projects']])assert.ok(elements.some(e=>e.role===role&&e.text===value));
});
test('copying a maximum-length page name remains inside its 120-character bound',()=>{
 const page=createDefaultSite().pages[1];page.name='长'.repeat(120);const copy=copyPage(page,'/name-boundary');assert.equal(copy.name,'长'.repeat(115)+' copy');assert.equal(copy.name.length,120);assert.doesNotThrow(()=>validatePage(copy));assert.equal(page.name.length,120);
});


test('hyperlinks recognize only exact site origins, retain stable targets and reject unsafe inputs',async()=>{
 const {parseDesignerLink,suggestedPagePath}=await import('../src/lib/designer/links.ts');
 const site=createDefaultSite(),page=site.pages[0],block=page.blocks[0];
 assert.deepEqual(parseDesignerLink('https://admin.example.test/#'+block.id,site,'/','https://admin.example.test'),{pageId:page.id,anchor:block.id});
 assert.deepEqual(parseDesignerLink('https://admin.example.test.evil.example/',site,'/','https://admin.example.test'),{external:'https://admin.example.test.evil.example/'});
 assert.deepEqual(parseDesignerLink('mailto:test@example.com',site,'/','https://admin.example.test'),{external:'mailto:test@example.com'});
 for(const value of ['','javascript:alert(1)','https://user:pass@admin.example.test/','https://admin.example.test/not-created','https://admin.example.test/?draft=1','https://admin.example.test/#%0a'])assert.throws(()=>parseDesignerLink(value,site,'/','https://admin.example.test'),value);
 const link={pageId:site.pages[1].id,newTab:true};site.header.blocks[0].elements[0].link=link;validateSite(site);
 site.pages[1].path='/renamed-target';assert.equal(resolveLink(site,link),'/renamed-target');
 assert.throws(()=>validateSite({...site,header:{...site.header,blocks:[{...site.header.blocks[0],elements:[{...site.header.blocks[0].elements[0],link:{...link,newTab:'yes'}}]}]}}));
 site.pages[1].path='/new-page';assert.equal(suggestedPagePath('新页面',site),'/new-page-2');assert.equal(suggestedPagePath('Admin',site),'/page-admin');
});
