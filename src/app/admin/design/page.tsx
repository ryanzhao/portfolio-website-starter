import Link from 'next/link';
import {headers} from 'next/headers';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {requireAdmin,readAdminConfig,AdminAuthError} from '@/lib/admin-auth';
import {contentClient} from '@/lib/content-client';
import {readDesignerSession} from '@/lib/designer/http';
import {sessionSite} from '@/lib/designer/catalog';
import {designerMedia} from '@/lib/designer/resources';
import type {FontStorage} from '@/lib/designer/fonts';
import {DesignerEditor} from '@/components/designer-editor';
export const dynamic='force-dynamic';
export const metadata={title:'全站设计器',robots:{index:false,follow:false}};
export default async function DesignerAdmin(){
  let state:Awaited<ReturnType<typeof readDesignerSession>>,media:Awaited<ReturnType<typeof designerMedia>>;
  try{
    const config=readAdminConfig(process.env),identity=await requireAdmin(new Request(`${config.origin}/admin/design`,{headers:await headers()}),config);
    const {env}=await getCloudflareContext({async:true}),storage=env as unknown as FontStorage,client=contentClient(process.env);
    state=await readDesignerSession(client);
    media=await designerMedia(sessionSite(state),client,state.page.id,{storage,owner:identity.subject});
  }catch(error){console.error('designer-open-failed',error instanceof Error?error.message:'unknown');return <section lang="zh-CN" className="page-section"><h1>暂时无法打开设计器</h1><p>{error instanceof AdminAuthError?error.message:'内容读取未完成，已保存的草稿和原版网页仍保留。请刷新，或到高级管理检查连接。'}</p><Link href="/admin/design">重试</Link><p><Link href="/admin">返回原版管理页</Link></p></section>;}
  return <DesignerEditor initial={state} initialMedia={media} enabled={process.env.PUBLICATION_ENABLED==='true'}/>;
}
