import { createId, DesignerValidationError, resolveStyle, validatePage, type DesignerPage, type DesignerElement, type DesignerBlock, type Viewport } from './model.ts';

export function createElement(type:DesignerElement['type']='text'):DesignerElement {return {id:createId(),name:type,type,text:type==='text'?'New text':type==='button'?'Button':undefined,styles:{desktop:type==='cad'?{x:5,y:5,width:90,height:90}:{x:10,y:10,width:30,...(type==='text'?{fontSize:24}:{height:20})}}};}
export function createBlock(type:DesignerBlock['type']='free'):DesignerBlock {return {id:createId('block'),name:'New block',type,styles:{desktop:{minHeight:400}},elements:[]};}
export function createVideoGallery():DesignerBlock {
 return {id:createId('block'),name:'项目视频 · A版',type:'flow',template:'video-gallery',styles:{desktop:{padding:32,gap:24},mobile:{padding:20,gap:20}},elements:[
  {id:createId(),name:'视频区标题',type:'text',text:'In action',tag:'h2',styles:{desktop:{font:'georgia',fontSize:28}}},
  ...['Testing','Superconductor synthesis','Machining'].map(name=>({id:createId(),name,text:name,type:'video' as const,alt:name,styles:{desktop:{}}}))
 ]};
}
export function insertVideoGallery(page:DesignerPage,block=createVideoGallery()):DesignerBlock {
 const existing=page.blocks.find(b=>b.template==='video-gallery'&&!b.deleted);if(existing)return existing;
 const modelIndex=page.blocks.findLastIndex(b=>!b.deleted&&b.elements.some(e=>e.type==='cad'&&!e.deleted));
 page.blocks.splice(modelIndex<0?page.blocks.length:modelIndex+1,0,block);return block;
}
export function createPage(name='New page',path='/new-page'):DesignerPage {return {id:createId('page'),name,path,title:name,description:'',showHeader:true,showFooter:true,blocks:[createBlock()]};}
export function copyElements(elements:DesignerElement[]):DesignerElement[] {const groups=new Map<string,string>();const newGroup=(id:string)=>{if(!groups.has(id))groups.set(id,createId('group'));return groups.get(id)!;};return elements.map(element=>{const copy=structuredClone(element);copy.id=createId();delete copy.deleted;if(copy.groupId)copy.groupId=newGroup(copy.groupId);for(const viewport of ['tablet','mobile'] as const)if(copy.groupOverrides?.[viewport])copy.groupOverrides[viewport]=newGroup(copy.groupOverrides[viewport]);return copy;});}
export function copyBlock(block:DesignerBlock):DesignerBlock {return {...structuredClone(block),id:createId('block'),deleted:false,elements:copyElements(block.elements.filter(e=>!e.deleted))};}
export function copyPage(page:DesignerPage,path:string):DesignerPage {return {...structuredClone(page),id:createId('page'),name:`${page.name.slice(0,115)} copy`,path,deleted:false,redirectFrom:[],blocks:page.blocks.filter(b=>!b.deleted).map(copyBlock)};}
export function reorder<T extends {id:string}>(items:T[],id:string,index:number):T[] {const result=[...items];const from=result.findIndex(i=>i.id===id);if(from<0)return result;const [item]=result.splice(from,1);result.splice(Math.max(0,Math.min(result.length,index)),0,item);return result;}
export function resolveGroup(element:DesignerElement,viewport:Viewport='desktop'):string|undefined {return viewport==='desktop'?element.groupId:element.groupOverrides&&Object.hasOwn(element.groupOverrides,viewport)?element.groupOverrides[viewport]??undefined:element.groupId;}
function setGroup(element:DesignerElement,groupId:string|undefined,viewport:Viewport):DesignerElement {if(viewport!=='desktop')return {...element,groupOverrides:{...element.groupOverrides,[viewport]:groupId??null}};const copy={...element};if(groupId)copy.groupId=groupId;else delete copy.groupId;return copy;}
export function groupElements(block:DesignerBlock,ids:string[],viewport:Viewport='desktop'):DesignerBlock {const chosen=block.elements.filter(e=>ids.includes(e.id)&&!e.deleted);const existing=new Set(chosen.map(e=>resolveGroup(e,viewport)).filter(Boolean));const selected=block.elements.filter(e=>!e.deleted&&(ids.includes(e.id)||existing.has(resolveGroup(e,viewport))));if(selected.length<2||selected.length>50)throw new DesignerValidationError('组合需要同一区块的 2–50 个元素。');const groupId=createId('group');return {...block,elements:block.elements.map(e=>selected.some(s=>s.id===e.id)?setGroup(e,groupId,viewport):e)};}
export function ungroupElements(block:DesignerBlock,groupIds:string[],viewport:Viewport='desktop'):DesignerBlock {return {...block,elements:block.elements.map(e=>{const group=resolveGroup(e,viewport);return group&&groupIds.includes(group)?setGroup(e,undefined,viewport):e;})};}
export function moveElements(block:DesignerBlock,ids:string[],dx:number,dy:number,viewport:Viewport):DesignerBlock {return {...block,elements:block.elements.map(e=>{if(!ids.includes(e.id)||e.locked||e.deleted)return e;const style=resolveStyle(e.styles,viewport);return {...e,styles:{...e.styles,[viewport]:{...e.styles[viewport],x:(style.x??0)+dx,y:(style.y??0)+dy}}};})};}
export function transferElements(page:DesignerPage,sourceId:string,targetId:string,ids:string[],position?:{x:number;y:number},viewport:Viewport='desktop',dimensions?:{sourceWidth:number;sourceHeight:number;targetWidth:number;targetHeight:number}):DesignerPage {
 const copy=structuredClone(page),source=copy.blocks.find(b=>b.id===sourceId),target=copy.blocks.find(b=>b.id===targetId);if(!source||!target||source===target)return copy;
 const moved=source.elements.filter(e=>ids.includes(e.id)&&!e.locked&&!e.deleted);if(!moved.length)return copy;
 // Snapshot all effective memberships before changing desktop inheritance.
 const memberships=(['desktop','tablet','mobile'] as const).map(view=>{const original=new Map(source.elements.map(e=>[e.id,resolveGroup(e,view)]));const affected=new Set(moved.map(e=>original.get(e.id)).filter((id):id is string=>!!id));return {view,original,affected};});
 if(dimensions&&Object.values(dimensions).some(value=>!Number.isFinite(value)||value<=0))throw new DesignerValidationError('区块尺寸无效。');
 const ratioX=dimensions?dimensions.sourceWidth/dimensions.targetWidth:1,ratioY=dimensions?dimensions.sourceHeight/dimensions.targetHeight:1;
 const left=Math.min(...moved.map(e=>resolveStyle(e.styles,viewport).x??0)),top=Math.min(...moved.map(e=>resolveStyle(e.styles,viewport).y??0));
 source.elements=source.elements.filter(e=>!moved.includes(e));
 for(const e of moved){if(position||dimensions){const s=resolveStyle(e.styles,viewport);e.styles[viewport]={...e.styles[viewport],x:position?position.x+((s.x??0)-left)*ratioX:(s.x??0)*ratioX,y:position?position.y+((s.y??0)-top)*ratioY:(s.y??0)*ratioY,...(s.width!==undefined?{width:s.width*ratioX}:{}),...(s.height!==undefined?{height:s.height*ratioY}:{})};}}
 for(const {view,original,affected} of memberships)for(const group of affected){const remaining=source.elements.filter(e=>original.get(e.id)===group);for(const e of [...moved,...remaining]){if(original.get(e.id)!==group)continue;const keep=moved.includes(e)?remaining.length===0:remaining.filter(e=>!e.deleted).length>=2;if(view==='desktop'){if(keep)e.groupId=group;else delete e.groupId;}else e.groupOverrides={...e.groupOverrides,[view]:keep?group:null};}}
 target.elements.push(...moved);return validatePage(copy);
}
export function scaleElements(block:DesignerBlock,ids:string[],factor:number,viewport:Viewport,scaleText=true):DesignerBlock {
 if(!Number.isFinite(factor)||factor<=0)throw new DesignerValidationError('缩放比例无效。');const selected=block.elements.filter(e=>ids.includes(e.id)&&!e.deleted&&!e.locked);if(!selected.length)return block;
 const styles=selected.map(e=>resolveStyle(e.styles,viewport)),left=Math.min(...styles.map(s=>s.x??0)),top=Math.min(...styles.map(s=>s.y??0));
 if(scaleText&&selected.some((e,i)=>['text','button'].includes(e.type)&&((styles[i].fontSize??24)*factor<12||(styles[i].fontSize??24)*factor>160)))throw new DesignerValidationError('文字缩放达到 12–160px 字号边界。');
 return {...block,elements:block.elements.map(e=>{const i=selected.indexOf(e);if(i<0)return e;const s=styles[i];return {...e,styles:{...e.styles,[viewport]:{...e.styles[viewport],x:left+((s.x??0)-left)*factor,y:top+((s.y??0)-top)*factor,width:(s.width??30)*factor,...(s.height?{height:s.height*factor}:{}),...(scaleText&&['text','button'].includes(e.type)?{fontSize:(s.fontSize??24)*factor}:{})}}};})};
}
export function alignElements(block:DesignerBlock,ids:string[],alignment:'left'|'center'|'right'|'top'|'middle'|'bottom'|'horizontal'|'vertical',viewport:Viewport):DesignerBlock {
 const chosen=block.elements.filter(e=>ids.includes(e.id)&&!e.locked&&!e.deleted).map(e=>({e,s:resolveStyle(e.styles,viewport)}));if(chosen.length<2)return block;
 const horizontal=['left','center','right','horizontal'].includes(alignment),axis=horizontal?'x':'y',size=horizontal?'width':'height';const min=Math.min(...chosen.map(({s})=>s[axis]??0)),max=Math.max(...chosen.map(({s})=>(s[axis]??0)+(s[size]??0)));const distributed=['horizontal','vertical'].includes(alignment);if(distributed&&chosen.length<3)return block;
 chosen.sort((a,b)=>(a.s[axis]??0)-(b.s[axis]??0));const gap=(max-min-chosen.reduce((sum,{s})=>sum+(s[size]??0),0))/(chosen.length-1);let cursor=min;const positions=new Map<string,number>();for(const {e,s}of chosen){positions.set(e.id,distributed?cursor:['left','top'].includes(alignment)?min:['center','middle'].includes(alignment)?(min+max-(s[size]??0))/2:max-(s[size]??0));cursor+=(s[size]??0)+gap;}
 return {...block,elements:block.elements.map(e=>positions.has(e.id)?{...e,styles:{...e.styles,[viewport]:{...e.styles[viewport],[axis]:positions.get(e.id)}}}:e)};
}
export function recyclePage(page:DesignerPage,deleted=true):DesignerPage {if(page.path==='/'&&deleted)throw new DesignerValidationError('首页不能删除。');return {...page,deleted};}
export function recycleBlock(block:DesignerBlock,deleted=true):DesignerBlock {return {...block,deleted};}
export function recycleElements(block:DesignerBlock,ids:string[],deleted=true):DesignerBlock {return {...block,elements:block.elements.map(e=>ids.includes(e.id)?{...e,deleted}:e)};}
export type History<T>={past:T[];present:T;future:T[]};
export function createHistory<T>(present:T):History<T>{return {past:[],present:structuredClone(present),future:[]};}
export function pushHistory<T>(history:History<T>,present:T):History<T>{if(JSON.stringify(history.present)===JSON.stringify(present))return history;return {past:[...history.past,structuredClone(history.present)].slice(-100),present:structuredClone(present),future:[]};}
export function undo<T>(history:History<T>):History<T>{if(!history.past.length)return history;return {past:history.past.slice(0,-1),present:structuredClone(history.past.at(-1)!),future:[structuredClone(history.present),...history.future]};}
export function redo<T>(history:History<T>):History<T>{if(!history.future.length)return history;return {past:[...history.past,structuredClone(history.present)].slice(-100),present:structuredClone(history.future[0]),future:history.future.slice(1)};}
