import {canonical,type DesignerSite} from './model.ts';
import type {DesignerState} from './store.ts';
import {requireApiResponse} from '../api-response.ts';

export type SaveStatus={phase:'saved'|'waiting'|'saving'|'failed'|'conflict';message:string;pending:boolean;retryAt:number;remote?:DesignerState};
// One queue per mounted editor; in-memory edits survive failed requests, not browser closure.
export class DesignerSaveQueue {
  private current:DesignerSite;
  private saved:string;
  private revision:string|null;
  private publishedRevision:string|null;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private running:Promise<boolean>|undefined;
  private inFlight:string|undefined;
  private held=false;
  private stopped=false;
  private conflict=false;
  private retryAt=0;
  private notify:(status:SaveStatus)=>void;
  private request:typeof fetch;
  constructor(state:DesignerState,notify:(status:SaveStatus)=>void,request:typeof fetch=(input,init)=>fetch(input,init)){this.notify=notify;this.request=request;this.current=state.site;this.saved=canonical(state.site);this.revision=state.revision;this.publishedRevision=state.publishedRevision;}
  get pending(){const current=canonical(this.current);return current!==this.saved||this.inFlight!==undefined&&this.inFlight!==current;}
  get versions(){return {revision:this.revision,publishedRevision:this.publishedRevision};}
  private report(phase:SaveStatus['phase'],message:string,remote?:DesignerState){if(!this.stopped)this.notify({phase,message,pending:this.pending,retryAt:this.retryAt,...remote?{remote}:{}});}
  update(site:DesignerSite){this.current=site;clearTimeout(this.timer);if(this.conflict){this.report('conflict','远端版本已变化，本地输入仍保留。');return;}if(!this.pending){this.report('saved','全部已保存');return;}this.report('waiting','有未保存修改');this.schedule();}
  hold(held:boolean){this.held=held;clearTimeout(this.timer);if(!held&&this.pending&&!this.conflict)this.schedule();}
  private schedule(){if(this.stopped||this.held||this.conflict)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush();},Math.max(2000,this.retryAt-Date.now()));}
  async flush():Promise<boolean>{
    clearTimeout(this.timer);
    if(this.running){await this.running;return !this.pending;}
    const run=this.flushOnce();this.running=run;
    try{return await run;}finally{this.running=undefined;}
  }
  private async flushOnce():Promise<boolean>{
    if(this.stopped||this.held||this.conflict)return false;
    if(this.inFlight!==undefined){try{await this.compare(this.inFlight);}catch{this.report('failed','上次保存结果仍未确认，请恢复连接后重试。');return false;}if(this.stopped||this.held||this.conflict)return false;}
    if(!this.pending)return true;
    if(Date.now()<this.retryAt){this.report('waiting','请求限流，请等待倒计时后重试。');this.schedule();return false;}
    return this.save();
  }
  private async save():Promise<boolean>{
    const submitted=canonical(this.current),revision=this.revision;this.inFlight=submitted;this.report('saving','正在保存私有草稿…');
    try{
      const response=await this.request('/api/admin/design',{method:'POST',headers:{'Content-Type':'application/json'},body:`{"action":"save","revision":${JSON.stringify(revision)},"site":${submitted}}`});
      const result=await requireApiResponse(response).json();
      if(response.status===429){this.inFlight=undefined;const seconds=Number(response.headers.get('Retry-After'));this.retryAt=Date.now()+1000*(Number.isFinite(seconds)&&seconds>0?seconds:60);this.report('waiting',result.error??'请求限流，等待后重试。');this.schedule();return false;}
      if(!response.ok){if(response.status===409){await this.compare(submitted);return !this.pending;}throw new Error(result.error??'保存失败。');}
      if(canonical(result.site)!==submitted||typeof result.revision!=='string')throw new Error('保存结果与提交内容不一致。');
      this.accept(result,submitted);return !this.pending;
    }catch(error){
      // A lost response may follow a successful commit; read back before retrying writes.
      try{if(await this.compare(submitted))return !this.pending;}catch{/* Preserve the local draft until an explicit retry. */}
      if(!this.conflict)this.report('failed',error instanceof Error?error.message:'保存失败，本地输入仍保留。');return false;
    }
  }
  private accept(state:DesignerState,serialized:string){this.inFlight=undefined;this.saved=serialized;this.revision=state.revision;this.publishedRevision=state.publishedRevision;this.retryAt=0;this.report(this.pending?'waiting':'saved',this.pending?'保存完成，仍有后续修改待保存':'全部已保存');if(this.pending)this.schedule();}
  private async compare(submitted:string){
    const response=await this.request('/api/admin/design');if(!response.ok)throw new Error('无法读回草稿。');const remote=await response.json() as DesignerState;
    if(canonical(remote.site)===submitted){this.accept(remote,submitted);return true;}
    if(remote.revision!==this.revision){this.conflict=true;this.report('conflict','另一个窗口已修改草稿。请选择远端版本或明确重新应用本地内容。',remote);}
    else if(canonical(remote.site)===this.saved)this.inFlight=undefined;
    return false;
  }
  replace(state:DesignerState,keepLocal=false){clearTimeout(this.timer);this.inFlight=undefined;this.conflict=false;this.retryAt=0;this.revision=state.revision;this.publishedRevision=state.publishedRevision;this.saved=canonical(state.site);if(!keepLocal)this.current=state.site;this.update(this.current);}
  activate(){this.stopped=false;if(this.pending&&!this.conflict)this.schedule();}
  dispose(){this.stopped=true;clearTimeout(this.timer);}
}
