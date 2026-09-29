"use client";
/* eslint-disable @next/next/no-img-element -- Private media must bypass shared image optimization. */

import { Fragment, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { resolveLink, resolveStyle, type DesignerBlock, type DesignerElement, type DesignerPage, type DesignerSite, type ElementStyle, type Viewport } from '../lib/designer/model';
import { resolveGroup } from '../lib/designer/operations';
import { blockCanvasSize } from '../lib/designer/geometry';
import { layoutFonts } from '../lib/page-layout';
import { portfolioSections } from '../lib/portfolio';
import { projects } from '../lib/projects';
import type { SlotMedia } from '../lib/public-content';
import { CadViewer } from './cad-viewer';
import { ProjectVideo } from './project-video';
import { ProjectList } from './project-list';
import './designer-renderer.css';

export type DesignerRendererProps = {
  site: DesignerSite; page: DesignerPage; media: Record<string, SlotMedia | null>;
  viewport?: Viewport; editing?: boolean; privateFonts?: boolean;
  onSelect?: (elementId: string, blockId: string, event: MouseEvent<HTMLElement>) => void;
  onReset?: () => void;
};
const companion = (e: DesignerElement) => !!e.role && /^(cad-|filter-|media-|project-image-label$|project-draft$)/.test(e.role);
const fontFamily = (id: string) => layoutFonts[id as keyof typeof layoutFonts] ?? `"designer-${id}"`;
const positioned = (s: ElementStyle) => s.x !== undefined || s.y !== undefined;
function elementCss(s: ElementStyle, e: DesignerElement): CSSProperties {
  const text = e.type === 'text' || e.type === 'button';
  const display=e.type==='image'||e.type==='video'?'flex':e.type==='button'||e.role==='feature-button'?'inline-flex':['section-number','journey-year','reference-copy','journey-node'].includes(e.role??'')?'block':e.link||e.tag==='span'?'inline':'block';
  return { position: positioned(s) ? 'absolute' : undefined, right: positioned(s) ? 'auto' : undefined, bottom: positioned(s) ? 'auto' : undefined, left: s.x === undefined ? undefined : `${s.x}%`, top: s.y === undefined ? undefined : `${s.y}%`, width: s.width === undefined ? undefined : `${s.width}%`,
    height: !text && s.height !== undefined ? `${s.height}%` : undefined, minHeight: text && s.height !== undefined ? `${s.height}%` : positioned(s) ? 0 : undefined,
    transform: s.rotation ? `rotate(${s.rotation}deg)` : undefined, opacity: s.opacity === undefined ? undefined : s.opacity / 100, zIndex: s.z,
    fontFamily: s.font ? fontFamily(s.font) : undefined, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.italic ? 'italic' : undefined, textDecoration: s.underline ? 'underline' : undefined,
    color: s.color, background: s.background, textAlign: s.align, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing === undefined ? undefined : `${s.letterSpacing}em`,
    border: s.borderWidth === undefined ? undefined : `${s.borderWidth}px solid ${s.borderColor ?? 'currentColor'}`, borderRadius: s.radius, padding: s.padding, display: s.hidden || e.hidden ? 'none' : s.hidden === false && e.styles.desktop.hidden ? display : undefined };
}
// Only validated, bounded styles enter this serializer; strings are still escaped for style tags.
const cssText = (style: CSSProperties) => Object.entries(style).filter(([,v]) => v !== undefined).map(([key,v]) => `${key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}:${typeof v==='number'&&!['opacity','zIndex','fontWeight','lineHeight'].includes(key)?`${v}px`:v}`).join(';').replace(/</g,'\\3c ');

export function designerElementMedia(media:DesignerRendererProps['media'],e:DesignerElement|undefined){return e?(media[e.assetId??`legacy:${e.legacySlot}`]??(e.legacySlot?media[e.legacySlot]:null)):null;}
export function DesignerRenderer({ site, page, media, viewport, editing = false, privateFonts = false, onSelect, onReset }: DesignerRendererProps) {
  const host = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({ width: viewport==='mobile'?390:viewport==='tablet'?768:1440, viewport: 'desktop' as Viewport });
  const [blockWidths, setBlockWidths] = useState<Record<string,number>>({});
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = host.current; if (!node) return;
    const observer = new ResizeObserver(() => {
      const width=node.clientWidth;setContainer(previous=>previous.width===width?previous:{width,viewport:width<768?'mobile':width<1024?'tablet':'desktop'});
      const widths:Record<string,number>={};
      node.querySelectorAll<HTMLElement>('[data-designer-block]').forEach(block=>{const style=getComputedStyle(block);widths[block.dataset.designerBlock!]=block.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);});
      setBlockWidths(previous=>JSON.stringify(previous)===JSON.stringify(widths)?previous:widths);
    });
    observer.observe(node);node.querySelectorAll('[data-designer-block]').forEach(block=>observer.observe(block));return () => observer.disconnect();
  }, [page.id,page.blocks.length]);
  const view=viewport??container.viewport;
  const sharedLabels=site.footer.blocks.filter(block=>!block.deleted).flatMap(block=>block.elements);
  const findLabel=(block:DesignerBlock,role:string)=>block.elements.find(element=>element.role===role)??(/^(media-|project-image-label$|project-draft$)/.test(role)?sharedLabels.find(element=>element.role===role):undefined);
  const label=(block:DesignerBlock,role:string,fallback:string):ReactNode=>{
    const element=findLabel(block,role);if(!element)return fallback;if(element.deleted)return null;
    if(role==='filter-all')return element.hidden||resolveStyle(element.styles,view).hidden?'':element.textOverrides?.[view as 'mobile'|'tablet']??element.text??fallback;
    return <span style={elementCss({...resolveStyle(element.styles,view),x:undefined,y:undefined,width:undefined,height:undefined},element)}>{element.textOverrides?.[view as 'mobile'|'tablet']??element.text??fallback}</span>;
  };
  const asset=(e:DesignerElement)=>designerElementMedia(media,e);
  const elementStyle=(e:DesignerElement,v:Viewport,override?:ElementStyle)=>{
    const style=override??resolveStyle(e.styles,v);
    return asset(e)?.kind==='video'?{...style,rotation:0,flipX:false,flipY:false}:style;
  };
  const projectItems=projects.flatMap(project=>{
    const target=site.pages.find(p=>p.id===`project-${project.slug}`);if(!target||target.deleted)return [];
    const elements=target.blocks.filter(b=>!b.deleted).flatMap(b=>b.elements).filter(e=>!e.deleted);
    const title=elements.find(e=>e.tag==='h1'),overview=elements.findIndex(e=>e.tag==='h2');
    return [{...project,href:target.path,title:title?.textOverrides?.[view as 'mobile'|'tablet']??title?.text??target.title,summary:overview>=0?elements[overview+1]?.text??target.description:target.description}];
  });
  function renderElement(e:DesignerElement,b:DesignerBlock,extra='',override?:ElementStyle,placeholder=false):ReactNode {
    if(e.deleted)return null;
    const s=elementStyle(e,view,override),content=e.textOverrides?.[view as 'mobile'|'tablet']??e.text;
    const renderLabel=(role:string,fallback:string)=>label(b,role,fallback);
    const accessibleLabel=(role:string,fallback:string)=>{const source=findLabel(b,role);if(!source||source.deleted||source.hidden||resolveStyle(source.styles,view).hidden)return fallback;const value=(source.textOverrides?.[view as 'mobile'|'tablet']??source.text)?.trim();return value&&/[\p{L}\p{N}]/u.test(value)?value:fallback;};
    const href=placeholder?undefined:e.role==='admin-link'?'/admin':e.role==='skip-link'?'#designer-main':resolveLink(site,e.link);
    const props={ id:placeholder?undefined:e.id,'data-designer-element':placeholder?undefined:e.id,'data-designer-role':e.role,'data-designer-group':placeholder?undefined:resolveGroup(e,view),'data-designer-locked':e.locked||undefined,'data-auto-decoration':view==='mobile'&&!positioned(s)||undefined,'data-positioned-element':!placeholder&&positioned(s)||undefined,'data-flow-placeholder':placeholder||undefined,'aria-hidden':placeholder||undefined,inert:placeholder||undefined,
      className:`designer-element ${e.role??''} ${extra}`,style:placeholder?{...elementCss(s,e),visibility:'hidden' as const}:override?elementCss(s,e):undefined,
      onClick:editing&&!placeholder?(event:MouseEvent<HTMLElement>)=>{event.preventDefault();event.stopPropagation();if(!e.locked)onSelect?.(e.id,b.id,event);}:undefined };
    let body:ReactNode=content;
    if(b.template==='video-gallery'&&e.type==='video'){
      const actual=asset(e),title=content||e.alt||e.name;
      return <figure key={e.id} {...props} className={`${props.className} designer-video-card`}><ProjectVideo src={actual?.kind==='video'?actual.src:undefined} poster={(e.posterAssetId?media[e.posterAssetId]?.src:undefined)??(actual?.kind==='video'?actual.poster:undefined)} title={title} disabled={editing||placeholder}/><figcaption>{title}</figcaption></figure>;
    }
    if(e.type==='image'||e.type==='video'){
      const actual=asset(e),zoom=s.zoom??1,fx=s.focusX??50,fy=s.focusY??50;
      const frame:CSSProperties={objectFit:s.fit??(actual?.kind==='video'?'contain':'cover'),objectPosition:`${fx}% ${fy}%`};
      const inset=(1-1/zoom)*100;
      body=actual?<>{actual.kind==='video'?<video src={actual.src} poster={(e.posterAssetId?media[e.posterAssetId]?.src:undefined)??actual.poster} controls={!editing} inert={editing||placeholder||undefined} playsInline preload="metadata" aria-label={e.alt??actual.alt} style={{...frame,objectViewBox:zoom>1?`inset(${inset*fy/100}% ${inset*(100-fx)/100}% ${inset*(100-fy)/100}% ${inset*fx/100}%)`:undefined} as CSSProperties}/>:<img src={actual.src} alt={e.alt??actual.alt} loading="lazy" style={{...frame,transform:`scale(${zoom*(s.flipX?-1:1)},${zoom*(s.flipY?-1:1)})`,transformOrigin:`${fx}% ${fy}%`}}/>}{actual.caption&&<figcaption className="sr-only">{actual.caption}</figcaption>}{actual.kind==='video'&&zoom>1&&<span className="designer-crop-warning">{renderLabel('media-crop-warning','Zoomed video crop unavailable in this browser.')}</span>}</>:<><span className="slot-frame" aria-hidden="true"/><span className="slot-label" role="img" aria-label={e.alt??e.name}>{e.alt??e.name}<small>{renderLabel(e.role==='project-placeholder'?'project-image-label':'media-empty','IMAGE TO BE ADDED')}</small></span></>;
      return <figure key={e.id} {...props} className={`${props.className} photo-slot designer-media`}>{href?<a href={href} target={e.link?.newTab?'_blank':undefined} rel={e.link?.newTab?'noopener noreferrer':undefined} className="designer-media-link">{body}</a>:body}{editing&&!placeholder&&actual?.kind==='video'&&Object.values(e.styles).some(style=>style.rotation||style.flipX||style.flipY)&&<span className="designer-video-warning">视频保持正向播放；已忽略旋转和翻转。</span>}</figure>;
    }
    if(e.type==='cad'){const model=asset(e),legacyDemo=!e.assetId&&b.elements.some(label=>label.role==='cad-disclaimer');return <div key={e.id} {...props} className={`${props.className} designer-functional${legacyDemo?"":" designer-model-frame"}`}><div inert={editing||undefined}>{model?.kind==='model'?<CadViewer key={model.src} assetId={e.assetId} src={model.src} demo={false} title={content||e.name} alt={e.alt||model.alt} renderLabel={(role,fallback)=>role==='cad-badge'||role==='cad-instructions'?fallback:renderLabel(role,fallback)} accessibleLabel={accessibleLabel}/>:legacyDemo?<CadViewer title={content} renderLabel={renderLabel} accessibleLabel={accessibleLabel}/>:<div className="cad-stage" role="img" aria-label={e.alt||e.name}><p>{editing?(e.assetId?'模型尚未就绪；请在素材库检查转换状态。':'上传或选择 STEP 模型。'):'3D model not available.'}</p></div>}</div></div>;}
    if(e.type==='project-list')return <div key={e.id} {...props} className={`${props.className} designer-functional`}><div inert={editing||undefined}><ProjectList items={projectItems} renderLabel={renderLabel} accessibleLabel={accessibleLabel}/></div></div>;
    if(['rectangle','ellipse','line','arrow','icon'].includes(e.type)){
      body=e.type==='arrow'?'→':e.type==='icon'?({'arrow-up-right':'↗',plus:'+',minus:'−',star:'★',heart:'♥',check:'✓'}[e.icon??'star']):null;
      return <div key={e.id} {...props} role={e.alt?'img':undefined} aria-label={e.alt} aria-hidden={!e.alt&&!editing?true:undefined} className={`${props.className} designer-shape designer-${e.type}`}>{body}</div>;
    }
    if(e.role==='error-reset')return <button key={e.id} {...props} onClick={editing?props.onClick:onReset}>{content}</button>;
    if(href)return <a key={e.id} {...props} href={href} target={e.link?.newTab?'_blank':undefined} rel={e.link?.newTab?'noopener noreferrer':undefined} className={`${props.className} ${e.type==='button'?'feature-button':''}`}>{body}</a>;
    const Tag=e.tag??(e.type==='button'?'span':'p');return <Tag key={e.id} {...props}>{body}</Tag>;
  }
  function blockContent(b:DesignerBlock):ReactNode {
    const elements=b.elements.filter(e=>!e.deleted&&!companion(e));
    const draw=(e:DesignerElement,extra='')=>{const style=elementStyle(e,view);return positioned(style)?<Fragment key={e.id}>{renderElement(e,b,extra,{...style,x:undefined,y:undefined,width:undefined,height:undefined,rotation:undefined},true)}{renderElement(e,b,extra)}</Fragment>:renderElement(e,b,extra);};
    if(b.template==='video-gallery')return <>{elements.filter(e=>e.type!=='video').map(e=>draw(e))}<div className="designer-video-grid">{elements.filter(e=>e.type==='video').map(e=>draw(e))}</div></>;
    if(b.type==='header'){
      const nav=elements.filter(e=>e.role==='navigation');
      return <div className="portfolio-nav"><div className="designer-brand">{elements.filter(e=>e.role==='wordmark'||e.role==='brand-subtitle').map(e=>draw(e,e.role==='wordmark'?'mars-wordmark':''))}</div><button ref={menuButton} type="button" className="menu-button" aria-expanded={menu} aria-controls={`${b.id}-navigation`} onClick={()=>setMenu(!menu)}>{elements.filter(e=>e.role===(menu?'menu-close':'menu-open')).map(e=>draw(e))}</button><nav id={`${b.id}-navigation`} className={`category-nav ${menu?'is-open':''}`} onKeyDown={e=>{if(e.key==='Escape'){setMenu(false);menuButton.current?.focus();}}}>{nav.map(e=>draw(e))}</nav>{elements.filter(e=>!['navigation','wordmark','brand-subtitle','menu-open','menu-close'].includes(e.role??'')).map(e=>draw(e,e.role==='skip-link'?'skip-link':''))}{editing&&elements.filter(e=>e.role===(menu?'menu-open':'menu-close')).map(e=>draw(e,'designer-label-chip'))}</div>;
    }
    if(b.type==='hero')return <>{elements.filter(e=>e.role==='hero-photo').map(e=>draw(e))}<div className="hero-title-row">{elements.filter(e=>e.role!=='hero-photo').map(e=>draw(e))}</div></>;
    if(b.type==='bio')return <>{elements.filter(e=>e.role==='portrait-photo').map(e=>draw(e))}<div className="bio-copy">{elements.filter(e=>e.role!=='portrait-photo').map(e=>draw(e))}</div></>;
    if(b.type==='feature')return <><div className="feature-copy">{elements.filter(e=>!['feature-photo','secondary-photo'].includes(e.role??'')).map(e=>draw(e))}</div>{elements.filter(e=>['feature-photo','secondary-photo'].includes(e.role??'')).map(e=>draw(e))}</>;
    if(b.type==='journey'){
      // Reading order and semantic roles survive copying and ID regeneration.
      const starts=elements.flatMap((e,i)=>e.tag==='h3'?[i]:[]);
      const lastStep=elements.findLastIndex(e=>['journey-year','journey-node','journey-detail'].includes(e.role??''));
      const legendStart=lastStep<0?elements.length:lastStep+1;
      return <>{elements.slice(0,starts[0]??legendStart).map(e=>draw(e,e.tag==='p'?'journey-intro':''))}<div className="journey-grid-decoration" aria-hidden="true"/><div className="journey-grid">{starts.map((start,index)=>{
        const lane=elements.slice(start,starts[index+1]??legendStart),steps=lane.flatMap((e,i)=>e.role==='journey-year'?[i]:[]);
        return <section className="journey-lane" key={lane[0].id}>{lane.slice(0,steps[0]??lane.length).map(e=>draw(e))}<ol>{steps.map((from,i)=>{
          const step=lane.slice(from,steps[i+1]??lane.length),year=step[0].text?.match(/202[345]/)?.[0];
          return <li className={`journey-step ${year?'year-'+year:''}`} key={step[0].id}>{step.filter(e=>e.role!=='journey-detail').map(e=>draw(e))}<div className="journey-details">{step.filter(e=>e.role==='journey-detail').map(e=>draw(e))}</div>{i<steps.length-1&&<span className="designer-journey-arrow" aria-hidden="true"><span>↓</span></span>}</li>;
        })}</ol></section>;
      })}</div><div className="journey-legend">{elements.slice(legendStart).map(e=>draw(e,e.role==='legend-chip'?`year-${e.text?.match(/202[345]/)?.[0]??''}`:''))}</div></>;
    }
    if(view!=='desktop'){
      const drawn=new Set<string>();return elements.map(e=>{
        const group=resolveGroup(e,view);if(!group)return draw(e);if(drawn.has(group))return null;drawn.add(group);
        const members=elements.filter(x=>resolveGroup(x,view)===group),styles=members.map(x=>x.styles.desktop),effective=members.map(x=>resolveStyle(x.styles,view));
        if(effective.some(positioned))return <Fragment key={group}>{members.map(member=>draw(member))}</Fragment>;
        const explicitSizes=members.map(member=>member.styles[view]?.fontSize);
        const left=Math.min(...styles.map(s=>s.x??0)),top=Math.min(...styles.map(s=>s.y??0)),right=Math.max(...styles.map(s=>(s.x??0)+(s.width??20))),bottom=Math.max(...styles.map(s=>(s.y??0)+(s.height??10)));
        const blockStyle=resolveStyle(b.styles,view),dimensions=blockCanvasSize(b,'desktop',1440),w=Math.max(1,(right-left)*dimensions.width/100),h=Math.max(1,(bottom-top)*dimensions.height/100);
        const available=Math.max(1,((blockWidths[b.id]??(container.width*(blockStyle.contentWidth??100)/100-2*(blockStyle.padding??32)))-(Math.max(1,blockStyle.columns??1)-1)*(blockStyle.gap??20))/Math.max(1,blockStyle.columns??1));
        const wanted=Math.min(1,available/w),minimum=Math.max(0,...members.map((member,i)=>['text','button'].includes(member.type)&&explicitSizes[i]===undefined?12/(effective[i].fontSize??16):0)),scale=Math.max(wanted,minimum),tooSmall=wanted<minimum;
        return <div key={group} data-designer-group={group} data-group-overflow={tooSmall||undefined} className="designer-group" style={{width:w*scale,height:h*scale}}>{tooSmall&&<span className="designer-group-warning" role="status">{editing?'组合已达最小字号，无法适配当前宽度；请取消组合或调整此设备布局。':'This group cannot fit at the minimum text size. Adjust this device layout.'}</span>}{members.map((member,i)=>renderElement(member,b,'',{...effective[i],x:((styles[i].x??0)-left)/(right-left)*100,y:((styles[i].y??0)-top)/(bottom-top)*100,width:(styles[i].width??20)/(right-left)*100,height:(styles[i].height??10)/(bottom-top)*100,...(['text','button'].includes(member.type)?{fontSize:explicitSizes[i]??(effective[i].fontSize??16)*scale}:{})}))}</div>;
      });
    }
    return elements.map(e=>draw(e));
  }
  function renderBlock(b:DesignerBlock) {
    if(b.deleted)return null;
    const s=resolveStyle(b.styles,view),isPositioned=b.elements.some(e=>!e.deleted&&!companion(e)&&positioned(resolveStyle(e.styles,view))),feature=portfolioSections.find(x=>x.slug===b.id);
    const classes={hero:'portfolio-hero',bio:'portfolio-bio portfolio-container',journey:'journey-section portfolio-container',feature:`portfolio-feature ${b.template?.startsWith('feature-')?b.template:`feature-${feature?.layout??'split'}`}`,header:'portfolio-header',footer:'site-footer portfolio-container',free:'designer-free',flow:'designer-flow'};
    const background=s.backgroundAssetId?media[s.backgroundAssetId]:null;
    const labels=b.elements.filter(e=>companion(e)&&!e.role?.startsWith('cad-'));
    return <section key={b.id} id={b.id} data-designer-block={b.id} data-positioned={isPositioned||undefined} className={`designer-block ${classes[b.type]} ${b.template??(b.id.startsWith('work-')&&b.id.includes('-card-')?'work-card':'')}`}>
      {background&&<div className="designer-background" aria-hidden="true">{background.kind==='image'?<img src={background.src} alt=""/>:<video src={background.src} poster={background.poster} muted loop autoPlay playsInline/>}</div>}
      {blockContent(b)}{editing&&labels.length>0&&<div className="designer-labels" aria-label="功能文案（包含其他交互状态）">{labels.map(e=>renderElement(e,b,'designer-label-chip'))}</div>}
    </section>;
  }
  const cssFor=(v:Viewport)=>page.blocks.filter(b=>!b.deleted).map(b=>{
    const s=resolveStyle(b.styles,v),isPositioned=b.elements.some(e=>!e.deleted&&!companion(e)&&positioned(resolveStyle(e.styles,v)));
    const flowDisplay=b.template==='work-next'||b.type==='hero'||b.type==='footer'||b.type==='feature'&&(v==='mobile'||['feature-cover','feature-team'].includes(b.template??''))?'flex':b.type==='bio'||b.type==='feature'||b.type==='free'?(v==='mobile'?'flex':'grid'):'block';
    const blockStyle:CSSProperties={display:b.hidden||s.hidden?'none':s.hidden===false&&b.styles.desktop.hidden?flowDisplay:undefined,height:isPositioned?blockCanvasSize(b,v,container.width).height:s.height??(v!=='desktop'?'auto':undefined),minHeight:isPositioned?0:s.minHeight,background:s.background,color:s.color,padding:s.padding,gap:s.gap,gridTemplateColumns:s.columns?`repeat(${s.columns},minmax(0,1fr))`:undefined,width:s.contentWidth?`${s.contentWidth}%`:undefined,position:s.sticky?'sticky':undefined,top:s.sticky?0:undefined,marginTop:s.marginTop,marginBottom:s.marginBottom};
    return `.designer-renderer[data-designer-page="${page.id}"] [data-designer-block="${b.id}"]{${cssText(blockStyle)}}`+b.elements.filter(e=>!e.deleted).map(e=>`.designer-renderer[data-designer-page="${page.id}"] [data-designer-element="${e.id}"]{${v!=='desktop'&&positioned(e.styles.desktop)?'position:static;left:auto;top:auto;width:auto;height:auto;min-height:0;transform:none;':''}${cssText(elementCss(elementStyle(e,v),e))}}`).join('');
  }).join('');
  const responsive=viewport?cssFor(viewport):cssFor('desktop')+`@container designer (max-width:1023px) and (min-width:768px){${cssFor('tablet')}}@container designer (max-width:767px){${cssFor('mobile')}}`;
  const fonts=site.fonts.map(f=>`@font-face{font-family:"designer-${f.id}";src:url("${privateFonts?`/api/admin/design/fonts?id=${f.id}`:`/api/fonts?sha=${f.sha256}`}");font-weight:${f.weight};font-style:${f.style};font-display:swap;}`).join('');
  return <div ref={host} className="designer-renderer" data-designer-page={page.id} data-viewport={view} data-editing={editing||undefined} style={{'--ink':site.theme.color,'--accent':site.theme.accent,'--paper':site.theme.background,fontFamily:fontFamily(site.theme.font),color:site.theme.color,background:site.theme.background,maxWidth:site.theme.contentWidth} as CSSProperties} onClickCapture={editing?e=>{if((e.target as HTMLElement).closest('a,button,select,video'))e.preventDefault();}:undefined}>
    <style>{fonts+responsive}</style><div className={`designer-page ${page.blocks.some(b=>b.type==='hero')?'designer-home':page.blocks.some(b=>b.template?.startsWith('work-'))||page.path.startsWith('/work/')?'work-page':'page-section'}`} id={page.id.startsWith('global-')?undefined:'designer-main'}>{page.blocks.map(renderBlock)}</div>
  </div>;
}
