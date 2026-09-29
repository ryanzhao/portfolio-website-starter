import {cache} from 'react';
import {createClient} from '@sanity/client';
import {readStudioConfig} from '../studio-config';
import {iterateParts,type PageIndex,readCatalogRoot,readCatalogVersion,sessionSite,type DesignerCatalog} from './catalog';
import {designerMedia} from './resources';
import type {DesignerSite} from './model';
// One captured immutable root per React render, shared by layout, metadata and body paths.
export const publicDesignerRoot=cache(async()=>{
 const config=readStudioConfig(process.env);if(!config||process.env.PUBLIC_MEDIA_ENABLED!=='true')return null;
 const client=createClient({...config,apiVersion:'2026-09-19',perspective:'published',useCdn:false,timeout:8000,maxRetries:0});
 const root=await readCatalogRoot(client,true);return root?{client,root}:null;
});
export const publicDesigner=cache(async(path='/')=>{
 const state=await publicDesignerRoot();if(!state)return null;const {client,root}=state;
 let resolved=resolvePublishedPath(root.catalog,path);if(!resolved){for await(const {id,payload:index} of iterateParts<PageIndex>(client,root.catalog.pages.map(p=>p.index))){if(index.redirects.includes(path)){const page=root.catalog.pages.find(p=>p.index===id)!;resolved={page,redirect:page.path};break;}}}if(!resolved)return null;
 const session=await readCatalogVersion(client,root,resolved.page.id,root);return {session,site:sessionSite(session),client,redirect:resolved.redirect};
});
export function resolvePublishedPath(site:DesignerSite|DesignerCatalog,path:string){const page=site.pages.find(p=>!('deleted'in p&&p.deleted)&&p.path===path);if(page)return {page,redirect:null};const moved=site.pages.find(p=>!('deleted'in p&&p.deleted)&&'redirectFrom'in p&&p.redirectFrom?.includes(path));return moved?{page:moved,redirect:moved.path}:null;}
export async function publicDesignerMedia(pageId?:string,path='/'){const state=await publicDesigner(path);return state?designerMedia(state.site,state.client,pageId):{};}
export async function designerMetadata(path:string){const state=await publicDesigner(path);if(!state)return null;const page=state.session.page,media=page.shareAssetId?await designerMedia(state.site,state.client,page.id):{};return {title:page.title,description:page.description,robots:{index:false,follow:false},...(page.shareAssetId&&media[page.shareAssetId]?{openGraph:{images:[media[page.shareAssetId]!.src]}}:{})};}
