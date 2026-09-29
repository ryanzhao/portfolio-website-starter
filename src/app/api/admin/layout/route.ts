import { getCloudflareContext } from '@opennextjs/cloudflare';
import { contentClient } from '@/lib/content-client';
import { handleLayout } from '@/lib/layout-http';
import type { LayoutStorage } from '@/lib/layout-store';

export const dynamic = 'force-dynamic';
async function handle(request:Request) {
  return handleLayout(request,process.env,async()=>{
    const {env}=await getCloudflareContext({async:true});
    return {storage:env as unknown as LayoutStorage,client:contentClient(process.env)};
  });
}
export const GET=handle;
export const POST=handle;
