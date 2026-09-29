'use client';
import {useLayoutEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {DesignerRenderer,designerElementMedia} from './designer-renderer';
import {resolveStyle,type DesignerSite,type DesignerPage,type ElementStyle,type Viewport} from '../lib/designer/model';
import {resolveGroup,transferElements} from '../lib/designer/operations';
import type {DesignerMedia} from '../lib/designer/resources';

export type DesignSelection={blockId:string;ids:string[]};
type Box={left:number;top:number;width:number;height:number};
type Gesture={kind:string;startX:number;startY:number;page:DesignerPage;selection:DesignSelection;block:DOMRect;box:Box;frames:Map<string,Box>;fonts:Map<string,number>;moved:boolean;};
export function DesignerCanvas({site,page,media,viewport,width,zoom,selection,onSelect,onChange,onBegin,onEnd,onMessage,preview=false,pan=false,onZoom,onFiles,onTextBegin,onComposition,onNavigate,onEditShared,onCrop,scaleText,ratioLocked}:{site:DesignerSite;page:DesignerPage;media:DesignerMedia;viewport:Viewport;width:number;zoom:number;selection:DesignSelection|null;onSelect:(s:DesignSelection|null)=>void;onChange:(p:DesignerPage)=>void;onBegin:()=>void;onEnd:()=>void;onMessage:(s:string)=>void;preview?:boolean;pan?:boolean;onZoom:(n:number)=>void;onFiles:(files:File[],blockId?:string)=>void;onTextBegin:()=>void;onComposition:(held:boolean)=>void;onNavigate:(id:string,anchor?:string)=>void;onEditShared:(key:"header"|"footer",selection:DesignSelection|null)=>void;onCrop:(id:string)=>void;scaleText:boolean;ratioLocked:boolean}){
  const canvas=useRef<HTMLDivElement>(null),scroller=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null),space=useRef(false),panning=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const pointers=useRef(new Map<number,{x:number;y:number}>()),pinch=useRef<{distance:number;zoom:number}|null>(null);
  const [box,setBox]=useState<Box|null>(null),[guides,setGuides]=useState<{x?:number;y?:number}>({}),[target,setTarget]=useState<string|null>(null),[typing,setTyping]=useState<string|null>(null),[textInitial,setTextInitial]=useState('');
  const input=useRef<HTMLTextAreaElement>(null),draftText=useRef(''),textBefore=useRef<DesignerPage|null>(null);
  const find=(id:string)=>canvas.current?.querySelector<HTMLElement>(`[data-designer-element="${CSS.escape(id)}"]`);
  function measure(){if(!canvas.current||!selection?.ids.length)return null;const origin=canvas.current.getBoundingClientRect(),rects=selection.ids.map(find).filter((e):e is HTMLElement=>!!e).map(e=>e.getBoundingClientRect());if(!rects.length)return null;const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top));return {left:(left-origin.left)/zoom,top:(top-origin.top)/zoom,width:(Math.max(...rects.map(r=>r.right))-left)/zoom,height:(Math.max(...rects.map(r=>r.bottom))-top)/zoom};}
  useLayoutEffect(()=>{const update=()=>{const next=measure();setBox(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);};update();const observer=new ResizeObserver(update);if(canvas.current)observer.observe(canvas.current);window.addEventListener('resize',update);return()=>{observer.disconnect();window.removeEventListener('resize',update);};/* DOM measurement follows rendered geometry. */ // eslint-disable-next-line react-hooks/exhaustive-deps
  },[page,selection,zoom,width,viewport]);
  function frame(el:HTMLElement,block:DOMRect):Box{const r=el.getBoundingClientRect();return {left:100*(r.left-block.left)/block.width,top:100*(r.top-block.top)/block.height,width:100*r.width/block.width,height:100*r.height/block.height};}
  function begin(event:ReactPointerEvent,kind='move'){
    if(preview||typing||event.button!==0)return;
    const node=event.target as HTMLElement;
    if(pan||space.current){event.preventDefault();const s=scroller.current!;panning.current={x:event.clientX,y:event.clientY,left:s.scrollLeft,top:s.scrollTop};event.currentTarget.setPointerCapture(event.pointerId);return;}
    if(node.closest('textarea,input,select,[data-shared-page]'))return;
    const blockNode=node.closest<HTMLElement>('[data-designer-block]')??(selection?canvas.current?.querySelector<HTMLElement>(`[data-designer-block="${CSS.escape(selection.blockId)}"]`):null);
    if(!blockNode)return;
    const block=page.blocks.find(b=>b.id===blockNode.dataset.designerBlock);if(!block)return;
    const elementNode=node.closest<HTMLElement>('[data-designer-element]'),element=block.elements.find(e=>e.id===elementNode?.dataset.designerElement);
    if(element?.locked){onSelect({blockId:block.id,ids:[element.id]});onMessage('此元素已锁定，请先在图层中解锁。');return;}
    let ids=selection?.blockId===block.id?[...selection.ids]:[];
    if(element&&kind==='move'){
      const group=resolveGroup(element,viewport),clicked=group&&!event.ctrlKey?block.elements.filter(e=>!e.deleted&&resolveGroup(e,viewport)===group).map(e=>e.id):[element.id];
      if(event.shiftKey)ids=ids.includes(element.id)?ids.filter(id=>!clicked.includes(id)):[...new Set([...ids,...clicked])];else if(!ids.includes(element.id))ids=clicked;
    }
    if(!element&&kind==='move'&&!node.closest('[data-design-handle]')){kind='marquee';ids=[];}
    const picked={blockId:block.id,ids};onSelect(picked);
    const rect=blockNode.getBoundingClientRect(),frames=new Map<string,Box>(),fonts=new Map<string,number>();
    for(const e of block.elements.filter(e=>!e.deleted&&!e.locked&&ids.includes(e.id))){const n=find(e.id);if(n){fonts.set(e.id,parseFloat(getComputedStyle(n).fontSize));const s=resolveStyle(e.styles,viewport),f=frame(n,rect);frames.set(e.id,{left:s.x??f.left,top:s.y??f.top,width:s.width??f.width,height:s.height??f.height});}}
    if(kind!=='marquee'&&!frames.size)return;
    const values=[...frames.values()],box=values.length?{left:Math.min(...values.map(f=>f.left)),top:Math.min(...values.map(f=>f.top)),width:0,height:0}:{left:100*(event.clientX-rect.left)/rect.width,top:100*(event.clientY-rect.top)/rect.height,width:0,height:0};
    if(values.length){box.width=Math.max(...values.map(f=>f.left+f.width))-box.left;box.height=Math.max(...values.map(f=>f.top+f.height))-box.top;}
    gesture.current={kind,startX:event.clientX,startY:event.clientY,page:structuredClone(page),selection:picked,block:rect,box,frames,fonts,moved:false};onBegin();event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:ReactPointerEvent){
    if(pointers.current.has(event.pointerId))pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pinch.current&&pointers.current.size===2){const [a,b]=[...pointers.current.values()];onZoom(Math.max(.25,Math.min(2,pinch.current.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.current.distance)));return;}
    if(panning.current){const p=panning.current,s=scroller.current!;s.scrollLeft=p.left-event.clientX+p.x;s.scrollTop=p.top-event.clientY+p.y;return;}
    const g=gesture.current;if(!g)return;let dx=100*(event.clientX-g.startX)/g.block.width,dy=100*(event.clientY-g.startY)/g.block.height;
    if(Math.abs(event.clientX-g.startX)+Math.abs(event.clientY-g.startY)<3&&!g.moved)return;g.moved=true;
    if(g.kind==='marquee'){const x=g.box.left,y=g.box.top,w=dx,h=dy,block=g.page.blocks.find(b=>b.id===g.selection.blockId)!;const ids=block.elements.filter(e=>{const n=find(e.id);if(!n||e.locked||e.deleted)return false;const r=frame(n,g.block);return r.left<Math.max(x,x+w)&&r.left+r.width>Math.min(x,x+w)&&r.top<Math.max(y,y+h)&&r.top+r.height>Math.min(y,y+h);}).map(e=>e.id);onSelect({blockId:block.id,ids});return;}
    const next=structuredClone(g.page),block=next.blocks.find(b=>b.id===g.selection.blockId)!;const marked:{x?:number;y?:number}={};
    if(g.kind==='move'&&!event.altKey){const anchors=[0,50,100,...block.elements.filter(e=>!g.selection.ids.includes(e.id)&&!e.deleted).flatMap(e=>{const n=find(e.id);if(!n)return [];const f=frame(n,g.block);return [f.left,f.left+f.width/2,f.left+f.width];})];for(const a of anchors)if(Math.abs(g.box.left+dx-a)*g.block.width/100<6){dx=a-g.box.left;marked.x=a;break;}for(const a of [0,50,100])if(Math.abs(g.box.top+dy-a)*g.block.height/100<6){dy=a-g.box.top;marked.y=a;break;}}
    for(const e of block.elements){const f=g.frames.get(e.id);if(!f)continue;const s=resolveStyle(e.styles,viewport),st:ElementStyle={...e.styles[viewport],x:f.left,y:f.top,width:f.width,height:f.height};
      if(g.kind==='move'){st.x=f.left+dx;st.y=f.top+dy;}
      else if(g.kind==='rotate'){if(e.type==='video'||designerElementMedia(media,e)?.kind==='video')continue;const cx=g.block.left+(g.box.left+g.box.width/2)*g.block.width/100,cy=g.block.top+(g.box.top+g.box.height/2)*g.block.height/100;let angle=(Math.atan2(event.clientY-cy,event.clientX-cx)-Math.atan2(g.startY-cy,g.startX-cx))*180/Math.PI;if(event.shiftKey)angle=Math.round(angle/15)*15;st.rotation=((s.rotation??0)+angle+540)%360-180;}
      else{const newW=Math.max(.1,g.box.width+(g.kind.includes('w')?-dx:g.kind.includes('e')?dx:0));let newH=Math.max(.1,g.box.height+(g.kind.includes('n')?-dy:g.kind.includes('s')?dy:0));
        const corner=g.kind.length===2,ratio=corner&&ratioLocked&&!event.shiftKey&&(e.type!=='text'&&e.type!=='button'||g.frames.size>1);if(ratio)newH=g.box.height*newW/g.box.width;
        const sx=newW/g.box.width,sy=newH/g.box.height;st.x=g.box.left+(f.left-g.box.left)*sx+(g.kind.includes('w')?g.box.width-newW:0);st.y=g.box.top+(f.top-g.box.top)*sy+(g.kind.includes('n')?g.box.height-newH:0);st.width=f.width*sx;st.height=f.height*sy;
        if((g.frames.size>1||scaleText&&corner)&&['text','button'].includes(e.type)){const size=(s.fontSize??g.fonts.get(e.id)??24)*sx;if(size<12||size>160){onMessage('组合缩放达到 12–160px 字号边界。');return;}st.fontSize=size;}
        if(e.type==='text'&&g.frames.size===1)delete st.height;
      }
      e.styles[viewport]=st;
    }
    // Keep positioned content on the measured block coordinate system.
    block.styles[viewport]={...block.styles[viewport],height:Math.max(120,g.block.height/zoom)};const origin=canvas.current!.getBoundingClientRect();setGuides({x:marked.x===undefined?undefined:(g.block.left-origin.left+marked.x*g.block.width/100)/zoom,y:marked.y===undefined?undefined:(g.block.top-origin.top+marked.y*g.block.height/100)/zoom});onChange(next);
    if(g.kind==='move'){const destination=document.elementsFromPoint(event.clientX,event.clientY).map(n=>n.closest<HTMLElement>('[data-designer-block]')).find(n=>n&&canvas.current?.contains(n)&&n.dataset.designerBlock!==block.id);setTarget(destination?.dataset.designerBlock??null);}
  }
  function end(event:ReactPointerEvent){pointers.current.delete(event.pointerId);if(pointers.current.size<2)pinch.current=null;panning.current=null;const g=gesture.current;gesture.current=null;
    if(g?.moved&&g.kind==='move'&&target){const node=canvas.current?.querySelector<HTMLElement>(`[data-designer-block="${CSS.escape(target)}"]`),r=node?.getBoundingClientRect();if(r){try{const source=structuredClone(g.page),sourceBlock=source.blocks.find(b=>b.id===g.selection.blockId)!;for(const e of sourceBlock.elements){const f=g.frames.get(e.id);if(f)e.styles[viewport]={...e.styles[viewport],x:f.left,y:f.top,width:f.width,height:f.height};}onChange(transferElements(source,g.selection.blockId,target,g.selection.ids,{x:100*(event.clientX-r.left)/r.width,y:100*(event.clientY-r.top)/r.height},viewport,{sourceWidth:g.block.width,sourceHeight:g.block.height,targetWidth:r.width,targetHeight:r.height}));onSelect({blockId:target,ids:g.selection.ids});}catch(error){onChange(g.page);onMessage((error as Error).message);}}}
    if(g)onEnd();setGuides({});setTarget(null);
  }
  function editText(event:React.MouseEvent){if(preview)return;const id=document.elementsFromPoint(event.clientX,event.clientY).map(n=>n.closest<HTMLElement>('[data-designer-element]')).find(n=>n&&canvas.current?.contains(n))?.dataset.designerElement,block=page.blocks.find(b=>b.elements.some(e=>e.id===id)),e=block?.elements.find(e=>e.id===id);if(!e||e.locked)return;if(['image','video'].includes(e.type)){onSelect({blockId:block!.id,ids:[e.id]});onCrop(e.id);return;}if(!['text','button'].includes(e.type))return;onSelect({blockId:block!.id,ids:[e.id]});draftText.current=e.textOverrides?.[viewport==='desktop'?'mobile':viewport]??e.text??'';if(viewport==='desktop')draftText.current=e.text??'';textBefore.current=structuredClone(page);setTextInitial(draftText.current);setTyping(e.id);onTextBegin();setTimeout(()=>input.current?.focus({preventScroll:true}),0);event.preventDefault();}
  function updateText(value:string){draftText.current=value;if(!typing)return;const next=structuredClone(page),e=next.blocks.flatMap(b=>b.elements).find(e=>e.id===typing)!;if(viewport==='desktop')e.text=value;else e.textOverrides={...e.textOverrides,[viewport]:value};onChange(next);}
  function finishText(cancel=false){if(!typing)return;if(cancel&&textBefore.current)onChange(textBefore.current);textBefore.current=null;setTyping(null);onEnd();}
  function cancelGesture(){const g=gesture.current;gesture.current=null;if(g){onChange(g.page);onEnd();}setGuides({});setTarget(null);panning.current=null;}

  function sharedPage(key:'header'|'footer'){
    const shared=site[key];if(page.id===shared.id||!(key==='header'?page.showHeader:page.showFooter))return null;
    return <div data-shared-page={key}>
      {!preview&&<button type="button" className="designer-shared-entry">{key==='header'?'编辑全站页头 / 导航':'编辑全站页脚'} · 全站共用</button>}
      <DesignerRenderer site={site} page={shared} media={media} viewport={viewport} editing={!preview} privateFonts/>
    </div>;
  }
  function selectShared(node:HTMLElement){
    const key=node.closest<HTMLElement>('[data-shared-page]')?.dataset.sharedPage;if(key!=='header'&&key!=='footer')return false;
    const blockId=node.closest<HTMLElement>('[data-designer-block]')?.dataset.designerBlock,id=node.closest<HTMLElement>('[data-designer-element]')?.dataset.designerElement;
    onEditShared(key,blockId?{blockId,ids:id?[id]:[]}:null);return true;
  }

  return <div ref={scroller} className={`designer-scroll ${pan?'is-panning':''}`} tabIndex={0} aria-label="网页编辑画布" onKeyDown={e=>{if(e.key==='Escape'&&gesture.current){e.preventDefault();e.stopPropagation();cancelGesture();return;}if(e.code==='Space'&&!(e.target as HTMLElement).closest('input,textarea,[contenteditable]')){space.current=true;e.preventDefault();}}} onKeyUp={e=>{if(e.code==='Space')space.current=false;}} onBlur={()=>{space.current=false;}} onPointerDown={e=>{pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.current.size===2){if(gesture.current){onChange(gesture.current.page);gesture.current=null;onEnd();}const[a,b]=[...pointers.current.values()];pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};}else begin(e);}} onPointerMove={move} onPointerUp={end} onPointerCancel={e=>{cancelGesture();pointers.current.delete(e.pointerId);pinch.current=null;}} onDoubleClick={editText} onClickCapture={e=>{if(!preview&&selectShared(e.target as HTMLElement)){e.preventDefault();e.stopPropagation();return;}if(preview){const link=(e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');if(link&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&link.target!=='_blank'){const url=new URL(link.href,window.location.href),target=site.pages.find(p=>!p.deleted&&p.path===url.pathname);if(url.origin===window.location.origin&&target){e.preventDefault();onNavigate(target.id,url.hash?decodeURIComponent(url.hash.slice(1)):undefined);}}}if(!preview&&(e.target as HTMLElement).closest('a,button,video')){e.preventDefault();e.stopPropagation();if(e.detail===0){const node=(e.target as HTMLElement).closest<HTMLElement>('[data-designer-element]'),blockId=node?.closest<HTMLElement>('[data-designer-block]')?.dataset.designerBlock,id=node?.dataset.designerElement;if(blockId&&id&&!node?.dataset.designerLocked)onSelect({blockId,ids:[id]});}}}} onDragOver={e=>{if(!preview&&e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if(preview||!e.dataTransfer.files.length)return;e.preventDefault();onFiles([...e.dataTransfer.files],(e.target as HTMLElement).closest<HTMLElement>('[data-designer-block]')?.dataset.designerBlock);}}>
    <div className="designer-scaled-space" style={{width:width*zoom,minHeight:800*zoom}}><div ref={canvas} className="designer-canvas" style={{width,zoom}}>
      {sharedPage('header')}
      <DesignerRenderer site={site} page={page} media={media} viewport={viewport} editing={!preview} privateFonts />
      {sharedPage('footer')}
      {!preview&&box&&<div className="designer-selection" style={box} data-design-handle="move" onPointerDown={e=>{e.stopPropagation();begin(e);}}>
        {(['nw','n','ne','e','se','s','sw','w'] as const).map(handle=><button key={handle} className={`designer-handle handle-${handle}`} data-design-handle={handle} aria-label={`缩放 ${handle}`} onPointerDown={e=>{e.stopPropagation();begin(e,handle);}}/>)}
        {selection?.ids.length===1&&page.blocks.flatMap(b=>b.elements).find(e=>e.id===selection.ids[0])?.type!=='video'&&designerElementMedia(media,page.blocks.flatMap(b=>b.elements).find(e=>e.id===selection.ids[0]))?.kind!=='video'&&<button className="designer-rotate" data-design-handle="rotate" aria-label="旋转所选元素" onPointerDown={e=>{e.stopPropagation();begin(e,'rotate');}}>↻</button>}
      </div>}
      {target&&<div className="designer-drop-note">移入：{page.blocks.find(b=>b.id===target)?.name}</div>}
      {guides.x!==undefined&&<i className="designer-guide-x" style={{left:guides.x}}/>}{guides.y!==undefined&&<i className="designer-guide-y" style={{top:guides.y}}/>}
      {typing&&box&&<textarea spellCheck={false} data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" ref={input} className="designer-inline-text" aria-label="直接编辑文字" style={{...box,minHeight:80}} maxLength={2000} onPaste={event=>{const n=event.currentTarget;if(n.value.length-(n.selectionEnd-n.selectionStart)+event.clipboardData.getData('text/plain').length>2000){event.preventDefault();onMessage('粘贴后会超过 2000 字，已保留原文字。请拆成多个文本框。');}}} defaultValue={textInitial} onChange={e=>updateText(e.target.value)} onCompositionStart={()=>onComposition(true)} onCompositionEnd={()=>onComposition(false)} onBlur={()=>finishText()} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();finishText(true);}if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();finishText();}}}/>}
    </div></div>
  </div>;
}
