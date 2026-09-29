import type {DesignerCatalog,DesignerSession,PageSummary} from './catalog.ts';
import type {DesignerPage,DesignerSite} from './model.ts';
import type {DesignerState} from './store.ts';
import type {History} from './operations.ts';
import {requireApiResponse} from '../api-response.ts';

import {canonical} from './model.ts';
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function summaryPage({part,index,...page}:PageSummary):DesignerPage{void part;void index;return {...page,blocks:[]};}
// This is a rendering directory, never a persistence payload. Only loadedPages are staged.
export function sessionView(session:DesignerSession,loadedPages=new Map([[session.page.id,session.page]])):DesignerSite {
  return {schemaVersion:2,pages:session.catalog.pages.map(p=>loadedPages.get(p.id)??summaryPage(p)),header:session.header,footer:session.footer,theme:session.theme,fonts:session.fonts};
}
export function publishedDirectory(catalog:DesignerCatalog|null,site:DesignerSite):DesignerSite|null{return catalog?{...site,pages:catalog.pages.map(summaryPage)}:null;}
export function hydrateHistoryPage(history:History<DesignerSite>,body:DesignerPage):History<DesignerSite>{
  const fill=(site:DesignerSite)=>({...site,pages:site.pages.map(p=>p.id===body.id&&p.blocks.length===0?{...body,...p,blocks:body.blocks}:p)});
  return {past:history.past.map(fill),present:fill(history.present),future:history.future.map(fill)};
}
export class EditorSession {
  session:DesignerSession;
  readonly loadedPages=new Map<string,DesignerPage>();
  readonly knownPages=new Set<string>();
  private saved:DesignerSite;
  private fetcher:typeof fetch;
  private submitted:DesignerSite|undefined;
  constructor(session:DesignerSession,fetcher:typeof fetch=(input,init)=>fetch(input,init)){this.fetcher=fetcher;this.session=session;this.loadedPages.set(session.page.id,session.page);this.knownPages.add(session.page.id);this.saved=sessionView(session,this.loadedPages);}
  get state():DesignerState{return {site:this.saved,revision:this.session.revision,publishedRevision:this.session.publishedRevision,publishedSite:publishedDirectory(this.session.publishedCatalog,this.saved)};}
  private async call(body?:object,query='') {
    const response=await this.fetcher(`/api/admin/design${query}`,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    requireApiResponse(response);if(!response.ok)return {response};return {response,value:await response.json()};
  }
  async load(id:string){
    if(id==='header'||id==='footer')return this.state;
    const {response,value}=await this.call(undefined,`?pageId=${encodeURIComponent(id)}${this.session.revision?'&revision='+encodeURIComponent(this.session.revision):''}`);
    if(!response.ok)throw new Error((await response.json()).error??'页面读取失败');
    this.session=value;this.loadedPages.set(value.page.id,value.page);this.knownPages.add(value.page.id);this.saved=sessionView(value,this.loadedPages);return this.state;
  }
  async adopt(session:DesignerSession){const loaded=new Map([[session.page.id,session.page]]);for(const id of this.loadedPages.keys()){if(id===session.page.id||!session.catalog.pages.some(p=>p.id===id))continue;const next=await this.call(undefined,`?pageId=${encodeURIComponent(id)}&revision=${encodeURIComponent(session.revision??'')}`);if(!next.response.ok)throw new Error('版本已变化，请重新读取后比较。');loaded.set(id,next.value.page);}this.session=session;this.loadedPages.clear();for(const [id,page] of loaded)this.loadedPages.set(id,page);this.saved=sessionView(session,this.loadedPages);return this.state;}
  // Adapter preserves queue serialization, conflict detection and lost-response recovery.
  request:typeof fetch=async(_url,options)=>{
    if(!options?.body){
      const result=await this.call();if(!result.response.ok)return result.response;
      const remote=result.value as DesignerSession,loaded=new Map<string,DesignerPage>([[remote.page.id,remote.page]]);
      for(const id of this.loadedPages.keys())if(id!==remote.page.id&&remote.catalog.pages.some(p=>p.id===id)){
        const next=await this.call(undefined,`?pageId=${encodeURIComponent(id)}&revision=${encodeURIComponent(remote.revision??'')}`);if(!next.response.ok)return next.response;loaded.set(id,next.value.page);
      }
      let site=sessionView(remote,loaded);
      if(this.submitted){const removed=this.submitted.pages.filter(p=>p.deleted&&!remote.catalog.pages.some(r=>r.id===p.id));if(removed.length)site={...site,pages:this.submitted.pages.flatMap(p=>{const live=site.pages.find(r=>r.id===p.id);return live?[live]:removed.some(r=>r.id===p.id)?[p]:[];}).concat(site.pages.filter(p=>!this.submitted!.pages.some(r=>r.id===p.id)))};}
      this.session=remote;this.loadedPages.clear();for(const [id,page] of loaded)this.loadedPages.set(id,page);this.saved=site;
      return Response.json({site,revision:remote.revision,publishedRevision:remote.publishedRevision,publishedSite:publishedDirectory(remote.publishedCatalog,site)});
    }
    const input=JSON.parse(String(options.body)) as {site:DesignerSite;revision:string|null};let revision=input.revision;this.submitted=input.site;
    if(revision===null){const init=await this.call({action:'initialize'});if(!init.response.ok)return init.response;if(!equal(init.value.catalog,this.session.catalog))throw new Error('初始化期间原版内容已改变，请重新读取比较。');this.session=init.value;revision=this.session.revision;}
    const expected=structuredClone(this.session.catalog);
    const receipts:string[]=[],deleted:string[]=this.session.catalog.pages.filter(p=>!input.site.pages.some(n=>n.id===p.id)).map(p=>p.id);
    for(const page of input.site.pages){
      const previous=this.saved.pages.find(p=>p.id===page.id),known=this.session.catalog.pages.some(p=>p.id===page.id);
      if(page.deleted){if(known)deleted.push(page.id);continue;}
      if(equal(previous,page))continue;
      if(known&&!this.loadedPages.has(page.id))throw new Error('页面尚未完整读取，不能提交其内容。');
      const staged=await this.call({action:'stagePage',revision,page});if(!staged.response.ok)return staged.response;receipts.push(staged.value.receipt);if(!staged.value.summary)throw new Error('页面暂存结果不完整。');const at=expected.pages.findIndex(p=>p.id===page.id);if(at<0)expected.pages.push(staged.value.summary);else expected.pages[at]=staged.value.summary;this.loadedPages.set(page.id,page);this.knownPages.add(page.id);
    }
    for(const key of ['header','footer','meta'] as const){const value=key==='meta'?{theme:input.site.theme,fonts:input.site.fonts}:input.site[key],old=key==='meta'?{theme:this.saved.theme,fonts:this.saved.fonts}:this.saved[key];if(equal(value,old))continue;const staged=await this.call({action:'stageShared',revision,key,value});if(!staged.response.ok)return staged.response;receipts.push(staged.value.receipt);if(!staged.value.ref)throw new Error('共享组件暂存结果不完整。');if(key==='meta')expected.meta=staged.value.ref;else expected[key]=staged.value.ref;}
    expected.pages=input.site.pages.filter(p=>!p.deleted).map(p=>expected.pages.find(e=>e.id===p.id)!);
    const committed=await this.call({action:'commit',revision,receipts,deletePageIds:deleted,order:input.site.pages.filter(p=>!p.deleted).map(p=>p.id)});if(!committed.response.ok)return committed.response;
    if(!equal(committed.value.catalog,expected))throw new Error('保存后版本已变化，请读回并比较。');
    this.session=committed.value;
    for(const page of input.site.pages)if(!page.deleted&&(this.loadedPages.has(page.id)||!this.saved.pages.some(p=>p.id===page.id))){this.loadedPages.set(page.id,page);this.knownPages.add(page.id);}
    // The queue acknowledges exactly the local edit; recycling is refreshed separately.
    this.saved=input.site;
    return Response.json({...this.state,site:input.site});
  };
}
