import {isSafePath,isSafeExternalLink,type DesignerLink,type DesignerSite} from './model.ts';

/** Convert only known site origins; similar-looking external domains remain external. */
export function parseDesignerLink(value:string,site:DesignerSite,currentPath:string,origin:string):DesignerLink {
  const input=value.trim();
  if(!input||/[\s\u0000-\u001f\\]/.test(input))throw new Error('链接地址不能为空或包含空白字符。');
  const base=new URL(currentPath,origin),url=new URL(input,base);
  if(url.username||url.password)throw new Error('链接不能包含登录凭据。');
  const internal=url.origin===new URL(origin).origin;
  if(internal){
    if(url.search)throw new Error('站内链接不支持查询参数，请选择目标页面和区块。');
    const page=site.pages.find(p=>!p.deleted&&(p.path===url.pathname||p.redirectFrom?.includes(url.pathname)));
    if(!page)throw new Error('未找到此站内页面，请选择已有页面或新建页面。');
    const anchor=decodeURIComponent(url.hash.slice(1));
    if(anchor&&!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/.test(anchor))throw new Error('区块地址无效，请从列表选择。');
    return {pageId:page.id,...anchor?{anchor}:{}};
  }
  if(!isSafeExternalLink(input))throw new Error('请输入有效的 HTTPS 网址、邮箱或电话。');
  return {external:input};
}

export function suggestedPagePath(name:string,site:DesignerSite):string {
  const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'new-page';
  const base=isSafePath('/'+slug)?'/'+slug:'/page-'+slug;
  let path=base,index=2;
  while(site.pages.some(p=>p.path===path||p.redirectFrom?.includes(path)))path=base+'-'+index++;
  return path;
}
