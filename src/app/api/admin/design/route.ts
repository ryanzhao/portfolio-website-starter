import {getCloudflareContext} from '@opennextjs/cloudflare';
import {contentClient} from '@/lib/content-client';
import {handleDesigner} from '@/lib/designer/http';
import type {FontStorage} from '@/lib/designer/fonts';
export const dynamic='force-dynamic';
async function handle(request:Request){return handleDesigner(request,process.env,async()=>{const {env}=await getCloudflareContext({async:true});return {client:contentClient(process.env),storage:env as unknown as FontStorage};});}
export const GET=handle;export const POST=handle;
