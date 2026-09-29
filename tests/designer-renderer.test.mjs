import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDefaultSite } from '../src/lib/designer/defaults.ts';
import { blockCanvasSize } from '../src/lib/designer/geometry.ts';
import { copyPage, copyBlock, insertVideoGallery } from '../src/lib/designer/operations.ts';
import {validatePage} from '../src/lib/designer/model.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function load(file){
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}});
  const require=createRequire(file);
  new Function('require','exports',outputText)(id=>{
    if(id.endsWith('.css'))return {};
    if(id.startsWith('.')||id.startsWith('@/')){
      const target=id.startsWith('@/')?resolve(root,'src',id.slice(2)):resolve(dirname(file),id);
      try{return require(target.endsWith('.ts')?target:`${target}.ts`);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;return load(`${target}.tsx`);}
    }
    return require(id);
  },exports);
  return exports;
}
const {DesignerRenderer}=load(resolve(root,'src/components/designer-renderer.tsx'));
const render=(site,page,props={})=>renderToStaticMarkup(createElement(DesignerRenderer,{site,page,media:{},...props}));

test('A video gallery inserts once after the model and keeps three ordered, independently playable media slots',()=>{
  const site=createDefaultSite(),page=site.pages[0],original=structuredClone(page.blocks);
  const gallery=insertVideoGallery(page),index=page.blocks.indexOf(gallery);
  assert.ok(page.blocks[index-1].elements.some(e=>e.type==='cad'));
  assert.equal(insertVideoGallery(page).id,gallery.id);
  assert.deepEqual(page.blocks.filter(b=>b!==gallery),original);
  const cards=gallery.elements.filter(e=>e.type==='video');
  assert.deepEqual(cards.map(e=>e.name),['Testing','Superconductor synthesis','Machining']);
  cards[0].assetId='118591ca-9bc6-44c4-b6e6-d953aa319563';validatePage(page);
  const media={[cards[0].assetId]:{kind:'video',src:'/test-video.mp4',poster:'/test-poster.webp',alt:'Testing',caption:''}};
  const html=render(site,page,{media});
  assert.match(html,/aria-label="Play Testing fullscreen"/);
  assert.match(html,/aria-label="Close video"/);
  assert.match(html,/preload="none"/);
  assert.doesNotMatch(html,/<video[^>]+src="\/test-video/,'no hidden player fetch until the visitor clicks');
  assert.match(html,/disabled="" aria-label="Superconductor synthesis: video to be added"/);
  assert.match(render(site,page,{media,editing:true}),/disabled="" aria-label="Play Testing fullscreen"/);
  assert.match(render(site,copyPage(page,'/copied'),{media}),/designer-video-grid/);
});

test('editing canvas includes shared navigation and footer with edit entries, without duplicating standalone shared pages',()=>{
  const {DesignerCanvas}=load(resolve(root,'src/components/designer-canvas.tsx')),site=createDefaultSite();
  const canvas=(page,preview=false)=>renderToStaticMarkup(createElement(DesignerCanvas,{site,page,media:{},viewport:'desktop',width:1440,zoom:1,selection:null,preview})).replace(/<style>[\s\S]*?<\/style>/g,'');
  const home=canvas(site.pages[0]);
  assert.match(home,/编辑全站页头/);assert.match(home,/编辑全站页脚/);
  for(const shared of [site.header,site.footer])assert.equal(home.split(`data-designer-page="${shared.id}"`).length-1,1);
  assert.ok(home.indexOf('data-designer-page="global-header"')<home.indexOf(`data-designer-page="${site.pages[0].id}"`));
  assert.doesNotMatch(canvas(site.pages[0],true),/编辑全站页头/);
  assert.doesNotMatch(canvas({...site.pages[0],showHeader:false,showFooter:false}),/data-designer-page="global-header"/);
  for(const shared of [site.header,site.footer])assert.equal(canvas(shared).split(`data-designer-page="${shared.id}"`).length-1,1);
});

test('default canvas preserves the Canva structures and every editable element exactly once',()=>{
  const site=createDefaultSite();
  for(const page of [...site.pages,site.header,site.footer]){
    const html=render(site,page,{editing:true,viewport:'desktop'});
    for(const e of page.blocks.flatMap(b=>b.elements))assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g,'').split(`data-designer-element="${e.id}"`).length-1,e.role?.startsWith('cad-')?0:1,`${page.id}: ${e.id}`);
    assert.doesNotMatch(html,/\[object Object\]/);
  }
  const html=render(site,site.pages[0]);
  for(const name of ['hero-title-row','bio-copy','journey-grid','feature-cover','feature-pair','feature-split','feature-team'])assert.ok(html.includes(name),name);
  assert.match(html,/<h1[^>]*>Ryan Zhao/);
});
test('geometry matches publication sizing, mobile overrides reset coordinates, text is escaped and video uses actual media kind',()=>{
  const site=createDefaultSite(),page=site.pages[0],block=page.blocks[0],text=block.elements.find(e=>e.role==='hero-title'),media=block.elements[0];
  text.text='<script>unsafe</script>\nSecond line';text.textOverrides={mobile:'Phone title'};text.styles.desktop={x:10,y:20,width:60,fontSize:44,rotation:10};
  media.assetId='118591ca-9bc6-44c4-b6e6-d953aa319563';media.styles.desktop={zoom:2,focusX:25,focusY:75};
  const html=render(site,page,{viewport:'desktop',media:{[media.assetId]:{kind:'video',src:'/private-video',alt:'Real video',caption:''}}});
  assert.match(html,/height:850px/);assert.equal(blockCanvasSize(block,'desktop',1440).height,850);
  assert.match(html,/left:10%/);assert.match(html,/rotate\(10deg\)/);assert.match(html,/&lt;script&gt;unsafe/);assert.match(html,/<video/);assert.match(html,/object-view-box/);assert.doesNotMatch(html,/<img[^>]*private-video/);
  const mobile=render(site,page,{viewport:'mobile'});assert.match(mobile,/Phone title/);assert.doesNotMatch(mobile,/left:10%/);
});
test('uploaded fonts use matching private/public endpoints and labels replace functional copy',()=>{
  const site=createDefaultSite();site.fonts=[{id:'118591ca-9bc6-44c4-b6e6-d953aa319563',family:'Owner font',sha256:'a'.repeat(64),weight:400,style:'normal'}];
  const page=site.pages.find(p=>p.id==='projects');page.blocks[0].elements.find(e=>e.role==='filter-discipline').text='Field';
  assert.match(render(site,page,{privateFonts:true}),/\/api\/admin\/design\/fonts\?id=/);
  const html=render(site,page);assert.match(html,/\/api\/fonts\?sha=/);assert.match(html,/>Field<\/span><select/);assert.doesNotMatch(html,/>Discipline<select/);
});

test('project cards resolve current page content, paths and deletion without changing filter identities',()=>{
  const site=createDefaultSite(),index=site.pages.find(p=>p.id==='projects'),apes=site.pages.find(p=>p.id==='project-apes');
  apes.path='/new-engineering';apes.blocks[0].elements.find(e=>e.tag==='h1').text='Edited project';
  site.pages.find(p=>p.id==='project-af-mpdt').deleted=true;
  const html=render(site,index);
  assert.match(html,/href="\/new-engineering"/);assert.match(html,/Edited project/);assert.doesNotMatch(html,/href="\/projects\/apes"|href="\/projects\/af-mpdt"/);
  assert.match(html,/Computational design/);
});

test('responsive visibility explicitly restores both block and element display',()=>{
  const site=createDefaultSite(),page=site.pages[0],block=page.blocks[1],element=block.elements[1];
  block.styles.desktop.hidden=true;block.styles.mobile={hidden:false};element.styles.desktop.hidden=true;element.styles.mobile={hidden:false};
  const html=render(site,page);
  assert.match(html,/data-designer-block="bio"\]\{display:none/);
  assert.match(html,/data-designer-block="bio"\]\{display:flex/);
  assert.match(html,/data-designer-element="bio-title"\]\{display:block/);
});

test('positioning one element preserves the original structure and reserves its flow space',()=>{
  const site=createDefaultSite(),page=site.pages[0];
  for(const id of ['bio','journey','electronics']){
    const block=page.blocks.find(b=>b.id===id);block.elements.find(e=>e.type==='text').styles.desktop={x:10,y:10,width:40};
  }
  const html=render(site,page,{viewport:'desktop'}).replace(/<style>[\s\S]*?<\/style>/g,'');
  for(const name of ['bio-copy','journey-grid','feature-copy'])assert.ok(html.includes(name));
  assert.equal((html.match(/data-flow-placeholder="true"/g)??[]).length,3);
  for(const b of page.blocks)for(const e of b.elements.filter(e=>!e.role?.startsWith('cad-')))assert.equal(html.split(`data-designer-element="${e.id}"`).length-1,1,e.id);
});

test('copied sections retain semantic journey and feature/work templates after media migration',()=>{
  const site=createDefaultSite(),original=site.pages[0];
  for(const b of original.blocks)for(const e of b.elements)delete e.legacySlot;
  const clone=copyPage(original,'/copied-home'),html=render(site,clone);
  for(const name of ['journey-lane','journey-step','feature-cover','feature-pair','feature-split','feature-team'])assert.equal((html.match(new RegExp(`class="[^"]*${name}`,'g'))??[]).length,(render(site,original).match(new RegExp(`class="[^"]*${name}`,'g'))??[]).length,name);
  const work=copyPage(site.pages.find(p=>p.id==='work-advanced-rockets-engines'),'/copied-work');
  assert.match(render(site,work),/designer-page work-page/);assert.equal(work.blocks.filter(b=>b.template==='work-card').length,3);
  assert.equal(copyBlock(original.blocks.find(b=>b.template==='feature-team')).template,'feature-team');
});

test('actual video kind disables inherited image rotation and explains the limitation in editing',()=>{
  const site=createDefaultSite(),page=site.pages[0],element=page.blocks[0].elements[0];
  element.assetId='118591ca-9bc6-44c4-b6e6-d953aa319563';element.styles.desktop={rotation:30,flipX:true};
  const html=render(site,page,{editing:true,media:{[element.assetId]:{kind:'video',src:'/actual-video',alt:'Video',caption:''}}});
  assert.doesNotMatch(html,/rotate\(30deg\)/);assert.match(html,/视频保持正向播放/);assert.match(html,/<video/);
});

test('moving a link preserves semantic and keyboard DOM order',()=>{
  const site=createDefaultSite(),page=site.pages[0],block=page.blocks.find(b=>b.id==='electronics');
  const button=block.elements.find(e=>e.type==='button');button.styles.desktop={x:40,y:50,width:20};
  const html=render(site,page,{viewport:'desktop'}).replace(/<style>[\s\S]*?<\/style>/g,'');
  const ids=[...html.matchAll(/data-designer-element="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(ids.indexOf(button.id)<ids.indexOf(block.elements.find(e=>e.role==='feature-photo').id));
  assert.match(html,new RegExp(`data-flow-placeholder="true"[^>]*>[\\s\\S]*?data-designer-element="${button.id}"`));
});

test('mobile groups preserve explicit font size and stop the entire unit at the inherited minimum',()=>{
  const site=createDefaultSite(),page=site.pages[0];
  const member=(id,x)=>({id,name:id,type:'text',tag:'p',text:id,groupId:'one-group',styles:{desktop:{x,y:0,width:50,height:20,fontSize:60}}});
  page.blocks=[{id:'group-test',name:'Group',type:'free',styles:{desktop:{}},elements:[member('first',0),member('second',50)]}];
  const [first,second]=page.blocks[0].elements;first.styles.mobile={fontSize:24};
  let html=render(site,page,{viewport:'mobile'});
  assert.match(html,/<p[^>]*data-designer-element="first"[^>]*style="[^"]*font-size:24px/);
  assert.doesNotMatch(html,/data-group-overflow="true"/);
  second.styles.desktop.fontSize=12;
  html=render(site,page,{viewport:'mobile'});
  assert.match(html,/data-group-overflow="true"/);assert.match(html,/cannot fit at the minimum text size/);assert.match(html,/class="designer-group" style="width:1440px/);
  first.styles.mobile={fontSize:24,x:5,y:5,width:40};second.styles.mobile={x:50,y:5,width:40};
  html=render(site,page,{viewport:'mobile'}).replace(/<style>[\s\S]*?<\/style>/g,'');
  for(const id of ['first','second'])assert.equal(html.split(`data-designer-element="${id}"`).length-1,1);
});

test('copied functional blocks resolve their own labels and editing disables only the functional subtree',()=>{
  const site=createDefaultSite(),page=site.pages[0],original=page.blocks.find(b=>b.elements.some(e=>e.type==='cad')),copy=copyBlock(original);
  original.elements.find(e=>e.role==='cad-load').text='ORIGINAL_LABEL';copy.elements.find(e=>e.role==='cad-load').text='COPIED_LABEL';page.blocks.push(copy);
  const html=render(site,page);
  assert.equal(html.split('>ORIGINAL_LABEL</span>').length-1,1);assert.equal(html.split('>COPIED_LABEL</span>').length-1,1);
  const editing=render(site,page,{editing:true});
  assert.equal((editing.match(/designer-functional"><div inert=""/g)??[]).length,2);
  assert.doesNotMatch(html,/designer-functional"><div inert=""/);
  const projectsPage=site.pages.find(p=>p.id==='projects');
  assert.match(render(site,projectsPage,{editing:true}),/designer-functional"><div inert=""/);
});

test('deleted, hidden or blank functional copy leaves a stable accessible control name',()=>{
  const site=createDefaultSite(),page=site.pages[0],cad=page.blocks.find(b=>b.elements.some(e=>e.type==='cad'));
  cad.elements.find(e=>e.role==='cad-load').deleted=true;
  assert.match(render(site,page),/<button[^>]*aria-label="Load 3D model"[^>]*><\/button>/);
  const projectsPage=site.pages.find(p=>p.id==='projects'),labels=projectsPage.blocks[0].elements;
  labels.find(e=>e.role==='filter-discipline').hidden=true;labels.find(e=>e.role==='filter-tag').text='   ';
  const html=render(site,projectsPage);
  assert.match(html,/<select[^>]*aria-label="Discipline"/);assert.match(html,/<select[^>]*aria-label="Tag"/);
  labels.find(e=>e.role==='filter-tag').text='My tags';
  assert.match(render(site,projectsPage),/<select[^>]*aria-label="My tags"/);
});


test('new-tab navigation and linked images render safe native links',()=>{
 const site=createDefaultSite(),page=site.pages[0],nav=site.header.blocks[0].elements.find(e=>e.role==='navigation'),picture=page.blocks.flatMap(b=>b.elements).find(e=>e.type==='image');
 nav.link={pageId:page.id,newTab:true};picture.link={external:'https://example.com',newTab:true};
 const {DesignerRenderer}=load(resolve(root,'src/components/designer-renderer.tsx'));
 const header=renderToStaticMarkup(createElement(DesignerRenderer,{site,page:site.header,media:{}}));
 const body=renderToStaticMarkup(createElement(DesignerRenderer,{site,page,media:{}}));
 assert.match(header,/href="\/" target="_blank" rel="noopener noreferrer"/);
 assert.match(body,/href="https:\/\/example.com" target="_blank" rel="noopener noreferrer" class="designer-media-link"/);
});

test('CAD binding never substitutes demonstration geometry for pending model and automatically starts real models',()=>{
  const site=createDefaultSite(),page=site.pages[0],block=page.blocks.find(b=>b.elements.some(e=>e.type==='cad')),cad=block.elements.find(e=>e.type==='cad');
  cad.assetId='118591ca-9bc6-44c4-b6e6-d953aa319563';cad.alt='Synthetic assembly';
  const pending=render(site,page,{editing:true});
  assert.match(pending,/模型尚未就绪/);assert.doesNotMatch(render(site,page),/Load 3D model ↗|INTERACTION DEMO/);
  const ready=render(site,page,{media:{[cad.assetId]:{kind:'model',src:'/api/admin/media?assetId='+cad.assetId+'&role=model',alt:cad.alt,caption:''}}});
  assert.match(ready,/Loading 3D model/);assert.doesNotMatch(ready,/<button[^>]*aria-label="Load 3D model"/);assert.match(ready,/INTERACTIVE MODEL/);assert.doesNotMatch(ready,/<model-viewer|INTERACTION DEMO|interaction-demo.gltf/);
});
