import { portfolioSections, journeyLanes } from './portfolio.ts';

export type Viewport = 'desktop' | 'tablet' | 'mobile';
export const layoutFonts = { arial: 'Arial, sans-serif', georgia: 'Georgia, serif', times: '"Times New Roman", serif', garet: 'Garet, Arial, sans-serif', system: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' } as const;
export type ElementLayout = { text?: string; hidden?: boolean; x?: number; y?: number; width?: number; height?: number; font?: keyof typeof layoutFonts; fontSize?: number; fontWeight?: 400|500|600|700; color?: string; lineHeight?: number; letterSpacing?: number; align?: 'left'|'center'|'right'; borderWidth?: number; borderColor?: string; radius?: number; fit?: 'contain'|'cover'; zoom?: number; focusX?: number; focusY?: number; z?: number };
type BlockView = { height?: number; elements: Record<string, ElementLayout> };
export type BlockLayout = BlockView & { overrides?: Partial<Record<'tablet'|'mobile',BlockView>> };
export type PageLayout = { schemaVersion: 1; blocks: Record<string, BlockLayout> };
export class LayoutValidationError extends Error {}
export const emptyPageLayout = (): PageLayout => ({schemaVersion:1,blocks:{}});
const blockIds: string[] = ['hero','bio','journey',...portfolioSections.map(section=>section.slug)];
const elementIds: Record<string,string[]> = {
  hero:['title','caption','media:home.hero'],
  bio:['title','lead','intro','gratitude','openness','note','media:home.portrait'],
  journey:['title','intro','legend-label','legend-2023','legend-2024','legend-2025',...journeyLanes.flatMap(lane=>[`lane:${lane.slug}:title`,...lane.steps.flatMap(step=>[`step:${lane.slug}:${step.year}:title`,`step:${lane.slug}:${step.year}:year`,...step.details.map((_,index)=>`step:${lane.slug}:${step.year}:detail:${index}`)])])],
  ...Object.fromEntries(portfolioSections.map(section=>[section.slug,['number','title','quote','button',`media:home.${section.slug}`,...(section.slug==='electronics'?['media:home.electronics.secondary']:[])]])),
};
const limits = {x:[0,100],y:[0,100],width:[0.1,100],height:[0.1,100],fontSize:[12,160],lineHeight:[1,2.5],letterSpacing:[-.05,.2],borderWidth:[0,20],radius:[0,100],zoom:[1,4],focusX:[0,100],focusY:[0,100],z:[0,50]} as const;
const fields = ['text','hidden','font','fontWeight','color','borderColor','align','fit',...Object.keys(limits)];
function fail(): never { throw new LayoutValidationError('布局包含无效属性、超出边界或过长的文字。'); }
function object(value: unknown): Record<string,unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail(); return value as Record<string,unknown>; }
function keys(value: Record<string,unknown>, allowed: readonly string[]) { if(Object.keys(value).some(key=>!allowed.includes(key))) fail(); }
function number(value: unknown, min: number, max: number) { if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max) fail(); }
function element(input: unknown) {
  const value=object(input); keys(value,fields);
  for(const [key,entry] of Object.entries(value)) {
    if(Object.hasOwn(limits,key)) { const [min,max]=limits[key as keyof typeof limits]; number(entry,min,max); }
    else if(key==='text') { if(typeof entry!=='string'||entry.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(entry)) fail(); }
    else if(key==='hidden') { if(typeof entry!=='boolean') fail(); }
    else if(key==='font') { if(typeof entry!=='string'||!Object.hasOwn(layoutFonts,entry)) fail(); }
    else if(key==='fontWeight') { if(![400,500,600,700].includes(entry as number)) fail(); }
    else if(key==='color'||key==='borderColor') { if(typeof entry!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(entry)) fail(); }
    else if(key==='align') { if(!['left','center','right'].includes(entry as string)) fail(); }
    else if(key==='fit') { if(!['contain','cover'].includes(entry as string)) fail(); }
  }
  if(value.z!==undefined&&!Number.isInteger(value.z)) fail();
  for(const [position,size] of [['x','width'],['y','height']]) if(typeof value[position]==='number'&&typeof value[size]==='number'&&value[position]+value[size]>100.000001) fail();
}
export function validatePageLayout(input: unknown): PageLayout {
  const root=object(input); keys(root,['schemaVersion','blocks']); if(root.schemaVersion!==1) fail();
  const blocks=object(root.blocks); keys(blocks,blockIds);
  for(const [blockId,block] of Object.entries(blocks)) {
    const value=object(block); keys(value,['height','elements','overrides']);
    const views=[value];
    if(value.overrides!==undefined) { const overrides=object(value.overrides); keys(overrides,['tablet','mobile']); for(const view of Object.values(overrides)) {const entry=object(view); keys(entry,['height','elements']); views.push(entry);} }
    const added=new Set<string>();
    for(const view of views) {
      if(view.height!==undefined) number(view.height,120,6000);
      const elements=object(view.elements); if(Object.keys(elements).length>160) fail();
      for(const [id,entry] of Object.entries(elements)) {
        if(!/^[a-zA-Z][a-zA-Z0-9:.\-_]{0,119}$/.test(id)||['constructor','prototype','__proto__'].includes(id)) fail();
        if(id.startsWith('text-')) {if(!/^text-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) fail(); added.add(id);}
        else if(!elementIds[blockId].includes(id)) fail();
        element(entry);
      }
    }
    if(added.size>20) fail();
  }
  const layout=input as PageLayout;
  if(new TextEncoder().encode(JSON.stringify(layout)).byteLength>524288) fail();
  for(const [blockId,block] of Object.entries(layout.blocks)) for(const viewport of ['tablet','mobile'] as const) for(const id of Object.keys(block.overrides?.[viewport]?.elements??{})) element(resolveElement(layout,blockId,id,viewport));
  return structuredClone(layout);
}
export function resolveElement(layout: PageLayout, blockId: string, elementId: string, viewport: Viewport): ElementLayout {
  const block=layout.blocks[blockId]; if(!block) return {};
  const base={...block.elements[elementId]}; if(viewport==='desktop') return base;
  // Each narrower viewport keeps the original responsive flow until explicitly positioned.
  delete base.x; delete base.y; delete base.width; delete base.height;
  return {...base,...block.overrides?.[viewport]?.elements[elementId]};
}
export function resolveBlock(layout: PageLayout, blockId: string, viewport: Viewport): {height?:number} {
  const block=layout.blocks[blockId]; const height=viewport==='desktop'?block?.height:block?.overrides?.[viewport]?.height;
  return height===undefined?{}:{height};
}
