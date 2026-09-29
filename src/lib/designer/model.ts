import { layoutFonts } from '../page-layout.ts';
import { mediaSlots } from '../media.ts';

export function canonical(value:unknown):string {if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).filter(k=>(value as Record<string,unknown>)[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;return JSON.stringify(value)??'null';}

export type Viewport = 'desktop' | 'tablet' | 'mobile';
export const elementTypes = ['text','image','video','button','rectangle','ellipse','line','arrow','icon','cad','project-list'] as const;
export type ElementType = typeof elementTypes[number];
export const roles = ['hero-title','hero-caption','hero-photo','portrait-photo','bio-lead','reference-copy','section-number','feature-button','feature-photo','secondary-photo','journey-year','journey-node','journey-detail','legend-chip','eyebrow','page-intro','notice','text-link','wordmark','brand-subtitle','navigation','menu-open','menu-close','skip-link','admin-link','cad-label','cad-load','cad-loading','cad-error','cad-error-description','cad-retry','cad-instructions','cad-disclaimer','cad-badge','cad-reset','cad-left','cad-right','cad-zoom-in','cad-zoom-out','cad-idle','cad-description','cad-noscript','filter-discipline','filter-tag','filter-all','filter-empty','filter-count','filter-results','error-reset','media-empty','media-crop-warning','project-placeholder','project-image-label','project-draft','filter-project','filter-projects'] as const;
export type ElementStyle = { x?:number;y?:number;width?:number;height?:number;rotation?:number;opacity?:number;z?:number;font?:string;fontSize?:number;fontWeight?:400|500|600|700;italic?:boolean;underline?:boolean;color?:string;background?:string;align?:'left'|'center'|'right';lineHeight?:number;letterSpacing?:number;borderWidth?:number;borderColor?:string;radius?:number;fit?:'contain'|'cover';zoom?:number;focusX?:number;focusY?:number;flipX?:boolean;flipY?:boolean;padding?:number;hidden?:boolean; };
export type BlockStyle = {height?:number;minHeight?:number;background?:string;color?:string;padding?:number;gap?:number;columns?:number;contentWidth?:number;sticky?:boolean;hidden?:boolean;marginTop?:number;marginBottom?:number;backgroundAssetId?:string;};
export type ResponsiveStyle<T> = {desktop:T;tablet?:T;mobile?:T};
export type DesignerLink = ({pageId:string;anchor?:string} | {external:string}) & {newTab?:boolean};
export type DesignerElement = {id:string;name:string;type:ElementType;text?:string;textOverrides?:Partial<Record<'tablet'|'mobile',string>>;tag?:'h1'|'h2'|'h3'|'h4'|'p'|'span'|'blockquote';role?:typeof roles[number];link?:DesignerLink;assetId?:string;legacySlot?:string;alt?:string;posterAssetId?:string;icon?:'arrow-up-right'|'plus'|'minus'|'star'|'heart'|'check';groupId?:string;groupOverrides?:Partial<Record<'tablet'|'mobile',string|null>>;deleted?:boolean;hidden?:boolean;locked?:boolean;styles:ResponsiveStyle<ElementStyle>};
export const blockTemplates = ['feature-cover','feature-pair','feature-split','feature-team','work-heading','work-card','work-activity','work-next','video-gallery'] as const;
export type DesignerBlock = {template?:typeof blockTemplates[number];id:string;name:string;type:'free'|'flow'|'hero'|'bio'|'journey'|'feature'|'header'|'footer';styles:ResponsiveStyle<BlockStyle>;elements:DesignerElement[];deleted?:boolean;hidden?:boolean;};
export type DesignerPage = {id:string;name:string;path:string;title:string;description:string;showHeader:boolean;showFooter:boolean;blocks:DesignerBlock[];deleted?:boolean;redirectFrom?:string[];shareAssetId?:string;};
export type DesignerFont = {id:string;family:string;sha256:string;weight:400|500|600|700;style:'normal'|'italic'};
export type DesignerSite = {schemaVersion:2;pages:DesignerPage[];header:DesignerPage;footer:DesignerPage;theme:{background:string;color:string;accent:string;font:string;contentWidth?:number};fonts:DesignerFont[]};
export type Site = DesignerSite;
export const designerLimits = {pages:100,blocks:50,elementsPerBlock:100,elementsPerPage:500,groupMembers:50,pageBytes:768*1024,history:100} as const;
export class DesignerValidationError extends Error { constructor(message='设计内容包含无效属性或超过容量限制。') {super(message);this.name='DesignerValidationError';} }
function fail(message?:string):never {throw new DesignerValidationError(message);}
function object(v:unknown,keys:readonly string[]):Record<string,unknown> {if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Object.keys(v).some(k=>!keys.includes(k)))fail();return v as Record<string,unknown>;}
function str(v:unknown,max=2000) {if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))fail();}
function id(v:unknown) {if(typeof v!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/.test(v)||['constructor','prototype','__proto__'].includes(v))fail();}
function assetId(v:unknown) {if(typeof v!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v))fail('素材标识无效。');}
function bool(v:unknown) {if(typeof v!=='boolean')fail();}
function number(v:unknown,min:number,max:number) {if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail();}
function color(v:unknown) {if(typeof v!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(v))fail();}
const ranges={x:[-100,200],y:[-126,200],width:[.1,200],height:[.1,200],rotation:[-180,180],opacity:[0,100],z:[0,500],fontSize:[12,160],lineHeight:[1,2.5],letterSpacing:[-.05,.2],borderWidth:[0,20],radius:[0,100],zoom:[1,4],focusX:[0,100],focusY:[0,100],padding:[0,200]} as const;
function style(v:unknown,block=false) {
 const limits=block?{height:[120,12000],minHeight:[0,12000],padding:[0,200],gap:[0,200],columns:[1,12],contentWidth:[10,100],marginTop:[0,400],marginBottom:[0,400]}:ranges;
 const s=object(v,[...Object.keys(limits),'background','color','hidden',...(block?['sticky','backgroundAssetId']:['font','fontWeight','italic','underline','borderColor','align','fit','flipX','flipY'])]);
 for(const [k,value] of Object.entries(s)) {
  if(Object.hasOwn(limits,k)){const r=(limits as Record<string,readonly number[]>)[k];number(value,r[0],r[1]);if(['z','columns'].includes(k)&&!Number.isInteger(value))fail();}
  else if(['background','color','borderColor'].includes(k))color(value);
  else if(['italic','underline','flipX','flipY','sticky','hidden'].includes(k))bool(value);
  else if(k==='font')id(value);else if(k==='backgroundAssetId')assetId(value);
  else if(k==='fontWeight'){if(![400,500,600,700].includes(value as number))fail();}
  else if(k==='align'){if(!['left','center','right'].includes(value as string))fail();}
  else if(k==='fit'&&!['contain','cover'].includes(value as string))fail();
 }
}
function styles(v:unknown,block=false) {const s=object(v,['desktop','tablet','mobile']);if(!Object.hasOwn(s,'desktop'))fail();for(const entry of Object.values(s))style(entry,block);}
export function isSafePath(path:unknown):path is string {return typeof path==='string'&&path.length<=200&&(path==='/'||/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(path))&&!/^\/(?:admin|api|_next|_vercel|cdn-cgi|models|fonts|images|assets)(?:\/|$)/.test(path);}
export function isSafeExternalLink(url:unknown):url is string {
 if(typeof url!=='string'||url.length>2000||/[\s\u0000-\u001f\\]/.test(url))return false;
 if(/^mailto:[^@?]+@[^@?]+\.[^@?]+$/.test(url)||/^tel:\+?[0-9()-]{3,30}$/.test(url))return true;
 try {const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!!parsed.hostname;}catch{return false;}
}
function link(v:unknown){const l=object(v,['pageId','anchor','external','newTab']);if(l.newTab!==undefined)bool(l.newTab);if('external'in l){if('pageId'in l||'anchor'in l||!isSafeExternalLink(l.external))fail();}else{id(l.pageId);if(l.anchor!==undefined)id(l.anchor);}}
export function validatePage(input:unknown):DesignerPage {
 const p=object(input,['id','name','path','title','description','showHeader','showFooter','blocks','deleted','redirectFrom','shareAssetId']);id(p.id);str(p.name,120);str(p.title,200);str(p.description,1000);if(!isSafePath(p.path))fail('网址无效或属于系统保留路径。');bool(p.showHeader);bool(p.showFooter);if(p.deleted!==undefined)bool(p.deleted);if(p.shareAssetId!==undefined)assetId(p.shareAssetId);
 if(p.redirectFrom!==undefined){if(!Array.isArray(p.redirectFrom)||p.redirectFrom.length>100||p.redirectFrom.some(x=>!isSafePath(x)||x===p.path)||new Set(p.redirectFrom).size!==p.redirectFrom.length)fail('旧网址无效或重复。');}
 if(!Array.isArray(p.blocks)||p.blocks.length>designerLimits.blocks)fail();
 const groupOwners=new Map<string,string>();const ids=new Set<string>([p.id as string]);let count=0;const seen=(v:unknown)=>{id(v);if(ids.has(v as string))fail('内容 ID 重复。');ids.add(v as string);};
 for(const entry of p.blocks){const b=object(entry,['id','name','type','styles','elements','deleted','hidden','template']);seen(b.id);str(b.name,120);if(b.template!==undefined&&!blockTemplates.includes(b.template as typeof blockTemplates[number]))fail();if(!['free','flow','hero','bio','journey','feature','header','footer'].includes(b.type as string))fail();styles(b.styles,true);for(const k of ['deleted','hidden'])if(b[k]!==undefined)bool(b[k]);if(!Array.isArray(b.elements)||b.elements.length>designerLimits.elementsPerBlock)fail();count+=b.elements.length;const groups=new Map<string,number>();
  for(const element of b.elements){const e=object(element,['id','name','type','text','textOverrides','tag','role','link','assetId','legacySlot','alt','posterAssetId','icon','groupId','groupOverrides','deleted','hidden','locked','styles']);seen(e.id);str(e.name,120);if(!elementTypes.includes(e.type as ElementType))fail();if(e.text!==undefined)str(e.text);if(e.textOverrides!==undefined)for(const value of Object.values(object(e.textOverrides,['tablet','mobile'])))str(value);if(e.alt!==undefined)str(e.alt,300);if(e.tag!==undefined&&!['h1','h2','h3','h4','p','span','blockquote'].includes(e.tag as string))fail();if(e.role!==undefined&&!roles.includes(e.role as typeof roles[number]))fail();if(e.link!==undefined)link(e.link);if(e.assetId!==undefined)assetId(e.assetId);if(e.posterAssetId!==undefined)assetId(e.posterAssetId);if(e.icon!==undefined&&!['arrow-up-right','plus','minus','star','heart','check'].includes(e.icon as string))fail();if(e.groupOverrides!==undefined)for(const value of Object.values(object(e.groupOverrides,['tablet','mobile'])))if(value!==null)id(value);if(e.legacySlot!==undefined&&!mediaSlots.some(slot=>slot.id===e.legacySlot))fail();for(const k of ['deleted','hidden','locked'])if(e[k]!==undefined)bool(e[k]);if(e.groupId!==undefined){id(e.groupId);const key=e.groupId as string;if(groupOwners.has(key)&&groupOwners.get(key)!==b.id)fail('组合必须属于同一区块。');groupOwners.set(key,b.id as string);groups.set(key,(groups.get(key)??0)+1);if((groups.get(key)??0)>50)fail();}styles(e.styles);
   if(e.type==='video')for(const s of Object.values(e.styles as ResponsiveStyle<ElementStyle>))if(s.rotation||s.flipX||s.flipY)fail('视频不支持旋转或翻转。');
  }
 }
 for(const viewport of ['tablet','mobile'] as const){const owners=new Map<string,string>();for(const b of p.blocks as DesignerBlock[]){const groups=new Map<string,number>();for(const e of b.elements){const group=e.groupOverrides&&Object.hasOwn(e.groupOverrides,viewport)?e.groupOverrides[viewport]:e.groupId;if(!group)continue;if(owners.has(group)&&owners.get(group)!==b.id)fail('组合必须属于同一区块。');owners.set(group,b.id);groups.set(group,(groups.get(group)??0)+1);if(groups.get(group)!>50)fail();}}}
 if(count>designerLimits.elementsPerPage||new TextEncoder().encode(JSON.stringify(input)).byteLength>designerLimits.pageBytes)fail('页面超过 500 个元素或 768KiB 容量。');
 return structuredClone(input as DesignerPage);
}
export function validateSite(input:unknown):DesignerSite {
 const s=object(input,['schemaVersion','pages','header','footer','theme','fonts']);if(s.schemaVersion!==2||!Array.isArray(s.pages)||s.pages.filter(p=>!(p as DesignerPage)?.deleted).length>100)fail();
 const pages=[...s.pages,s.header,s.footer].map(validatePage);const ids=new Set<string>();const paths=new Set<string>();for(const p of pages){for(const value of [p.id,...p.blocks.flatMap(b=>[b.id,...b.elements.map(e=>e.id)])]){if(ids.has(value))fail('全站内容 ID 重复。');ids.add(value);}if(!p.deleted){for(const path of [p.path,...p.redirectFrom??[]]){if(paths.has(path))fail('网址或重定向冲突。');paths.add(path);}}}
 if(s.pages.filter(p=>p.path==='/'&&!p.deleted).length!==1)fail('网站必须保留唯一首页。');
 const header=s.header as DesignerPage,footer=s.footer as DesignerPage;
 if(header.id!=='global-header'||header.path!=='/global-header'||footer.id!=='global-footer'||footer.path!=='/global-footer'||header.deleted||footer.deleted)fail('全站页头和页脚的系统身份不能修改。');
 if((s.pages as DesignerPage[]).some(p=>[p.path,...p.redirectFrom??[]].some(path=>['/global-header','/global-footer'].includes(path))||(p.path==='/404'&&p.id!=='not-found')||(p.path==='/error'&&p.id!=='error')))fail('网址属于全站系统组件。');
 const t=object(s.theme,['background','color','accent','font','contentWidth']);for(const key of ['background','color','accent'])color(t[key]);id(t.font);if(t.contentWidth!==undefined)number(t.contentWidth,640,1920);
 if(!Array.isArray(s.fonts)||s.fonts.length>40)fail();const fonts=new Set<string>(Object.keys(layoutFonts));for(const entry of s.fonts){const f=object(entry,['id','family','sha256','weight','style']);assetId(f.id);str(f.family,100);if(typeof f.sha256!=='string'||! /^[a-f0-9]{64}$/.test(f.sha256))fail();if(fonts.has(f.id as string)||![400,500,600,700].includes(f.weight as number)||!['normal','italic'].includes(f.style as string))fail();fonts.add(f.id as string);}
 if(!fonts.has(t.font as string))fail('字体未登记。');for(const p of pages)for(const b of p.blocks)for(const e of b.elements)for(const st of Object.values(e.styles))if(st.font&&!fonts.has(st.font))fail('字体未登记。');
 return structuredClone(input as DesignerSite);
}
export function resolveStyle<T extends ElementStyle|BlockStyle>(styles:ResponsiveStyle<T>,viewport:Viewport):T {const base={...styles.desktop};if(viewport==='desktop')return base;for(const key of ['x','y','width','height','rotation'] as const)delete (base as ElementStyle)[key];return {...base,...styles[viewport]};}
export function resolvePagePath(site:DesignerSite,pageId:string):string|null {return site.pages.find(p=>p.id===pageId&&!p.deleted)?.path??null;}
export function resolveLink(site:DesignerSite,link:DesignerLink|undefined):string|undefined {if(!link)return;if('external'in link)return isSafeExternalLink(link.external)?link.external:undefined;const path=resolvePagePath(site,link.pageId);return path?path+(link.anchor?'#'+encodeURIComponent(link.anchor):''):undefined;}
export function createId(prefix='element'):string {return `${prefix}-${crypto.randomUUID()}`;}
