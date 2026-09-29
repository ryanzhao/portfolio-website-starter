import {resolveStyle,type DesignerBlock,type DesignerElement,type DesignerPage,type ElementStyle,type Viewport} from './model.ts';

export function blockCanvasSize(block:DesignerBlock,viewport:Viewport,width:number){
  const style=resolveStyle(block.styles,viewport);
  const defaults={free:500,flow:600,hero:850,bio:900,journey:1200,feature:900,header:120,footer:160};
  return {width:width*(style.contentWidth??100)/100,height:style.height??Math.max(style.minHeight??0,defaults[block.type])};
}
export function rotatedBounds(style:ElementStyle,dimensions:{width:number;height:number}){
  const x=style.x??0,y=style.y??0,width=style.width??0,height=style.height??0;
  const radians=(style.rotation??0)*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
  const w=width*c+height*dimensions.height/dimensions.width*s,h=height*c+width*dimensions.width/dimensions.height*s;
  return {left:x+(width-w)/2,top:y+(height-h)/2,right:x+(width+w)/2,bottom:y+(height+h)/2};
}
// The approved home hero intentionally extends above its short section without crossing the page width.
export function intentionalHeroBleed(page:DesignerPage,block:DesignerBlock,element:DesignerElement,bounds:ReturnType<typeof rotatedBounds>){
  return page.path==='/'&&block.id==='hero'&&element.id==='hero-media'&&element.type==='image'&&bounds.left>=-.1&&bounds.right<=100.1&&bounds.top>=-126.1&&bounds.bottom<=100.1;
}
