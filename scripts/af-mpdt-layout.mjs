import {validatePage} from '../src/lib/designer/model.ts';

// Approved photo-first layout; existing media IDs stay attached to editable elements.
export function afMpdtLayout(input) {
  const page=validatePage(input);
  if(page.id!=='project-af-mpdt')throw new Error('Expected the AF-MPDT page.');
  if(page.blocks.some(b=>b.id==='afmpdt-photo-cover'))throw new Error('Layout already applied; edit the saved design instead.');
  const elements=page.blocks.filter(b=>!b.deleted).flatMap(b=>b.elements);
  const model=elements.find(e=>e.type==='cad'&&e.assetId&&!e.deleted);
  const photo=elements.find(e=>e.id==='project-af-mpdt-placeholder');
  const title=elements.find(e=>e.tag==='h1'&&!e.deleted);
  if(!model||!photo||!title)throw new Error('Existing model, photo slot and title are required.');
  const paper='#f5f1e8',ink='#171717',orange='#ff8b3d';
  const box=(x,y,width,height,extra={})=>({x,y,width,height,...extra});
  const styles=(desktop,tablet=desktop,mobile=tablet)=>({desktop,tablet,mobile});
  const text=(id,value,tag,desktop,tablet=desktop,mobile=tablet)=>({id:`afmpdt-${id}`,name:value,type:'text',tag,text:value,styles:styles(desktop,tablet,mobile)});
  const white={color:'#ffffff',font:'arial',lineHeight:1.4};
  const cover={id:'afmpdt-photo-cover',name:'AF-MPDT · 大幅原图封面',type:'hero',styles:styles({height:800,padding:0,background:'#111111',color:'#ffffff'},{height:720,padding:0,background:'#111111',color:'#ffffff'},{height:640,padding:0,background:'#111111',color:'#ffffff'}),elements:[
    {...photo,name:'AF-MPDT · 在此替换原图',role:'hero-photo',alt:photo.assetId?photo.alt:'AF-MPDT photograph — original image to be added',styles:styles(box(0,0,100,100,{fit:'cover',focusX:50,focusY:50,background:'#282828'}))},
    {...title,role:'hero-title',styles:styles(box(4,6,92,25,{font:'georgia',fontSize:144,fontWeight:400,lineHeight:1,color:'#ffffff',letterSpacing:-.035,z:2}),box(4,7,92,25,{font:'georgia',fontSize:110,fontWeight:400,lineHeight:1,color:'#ffffff',letterSpacing:-.035,z:2}),box(5,8,90,18,{font:'georgia',fontSize:64,fontWeight:400,lineHeight:1,color:'#ffffff',letterSpacing:-.035,z:2}))},
    {id:'afmpdt-caption-backing',name:'照片文字底色',type:'rectangle',styles:styles(box(0,72,100,28,{background:'#000000b8',z:1}))},
    text('code','ETSD006T','p',box(4,76,50,4,{...white,fontSize:20,z:2}),box(4,75,70,4,{...white,fontSize:18,z:2}),box(5,73,90,4,{...white,fontSize:16,z:2})),
    text('subtitle','Applied-field magnetoplasmadynamic thruster','p',box(4,80,68,8,{...white,fontSize:22,z:2}),box(4,80,70,9,{...white,fontSize:18,z:2}),box(5,78,90,9,{...white,fontSize:16,z:2})),
    text('date','April 17, 2026','p',box(75,81,21,5,{...white,fontSize:18,align:'right',z:2}),box(76,81,20,5,{...white,fontSize:16,align:'right',z:2}),box(5,87,40,4,{...white,fontSize:14,z:2})),
    {...text('explore','EXPLORE IN 3D ↓','span',box(35,88,30,6,{color:orange,font:'arial',fontSize:18,align:'center',letterSpacing:.12,z:3}),box(30,88,40,6,{color:orange,font:'arial',fontSize:16,align:'center',letterSpacing:.1,z:3}),box(48,86,47,8,{color:orange,font:'arial',fontSize:14,align:'right',letterSpacing:.04,z:3})),link:{pageId:page.id,anchor:'afmpdt-model'}},
    {id:'afmpdt-card-top',name:'模型卡片上缘',type:'rectangle',styles:styles(box(2,96,96,4,{background:paper,z:3,radius:8}))},
  ]};
  const modelBlock={id:'afmpdt-model',name:'AF-MPDT · 交互模型',type:'free',styles:styles({height:850,padding:0,contentWidth:96,background:paper,color:ink},{height:850,padding:0,contentWidth:96,background:paper,color:ink},{height:930,padding:0,contentWidth:96,background:paper,color:ink}),elements:[
    text('interactive','INTERACTIVE 3D','p',box(4,1,90,4,{color:'#a33d00',fontSize:13,letterSpacing:.15})),
    text('geometry','From hardware to geometry.','h2',box(4,6,92,12,{font:'georgia',fontWeight:400,fontSize:58,lineHeight:1.15,color:ink}),box(4,6,92,12,{font:'georgia',fontWeight:400,fontSize:44,lineHeight:1.15,color:ink}),box(5,6,90,13,{font:'georgia',fontWeight:400,fontSize:34,lineHeight:1.15,color:ink})),
    {...model,text:'AF-MPDT testing platform',styles:styles(box(3,21,94,67,{background:'#e9e8e5',color:ink,radius:8}),box(3,21,94,67,{background:'#e9e8e5',color:ink,radius:8}),box(2,21,96,69,{background:'#e9e8e5',color:ink,radius:8}))},
    text('closing','Rotate. Zoom. Explore.','p',box(4,92,92,7,{font:'georgia',fontSize:36,align:'center',color:ink}),box(4,92,92,7,{font:'georgia',fontSize:32,align:'center',color:ink}),box(4,93,92,5,{font:'georgia',fontSize:26,align:'center',color:ink})),
  ]};
  const moved=new Set([model.id,photo.id,title.id]);
  // Retain the former draft copy and unused blocks, hidden and recoverable in the editor.
  const previous=page.blocks.map(b=>({...b,hidden:true,elements:b.elements.filter(e=>!moved.has(e.id))}));
  return validatePage({...page,blocks:[cover,modelBlock,...previous]});
}
