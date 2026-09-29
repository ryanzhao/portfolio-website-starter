import {getCloudflareContext} from '@opennextjs/cloudflare';
import {requireAdmin,readAdminConfig,AdminAuthError} from '@/lib/admin-auth';
import {requireWriteAllowance} from '@/lib/admin-write-limit';
import {UploadError} from '@/lib/uploads';
import {fontBytes,saveFont,publishFont,type FontStorage} from '@/lib/designer/fonts';
import {fontByteLimit} from '@/lib/designer/font-format';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
async function handle(request:Request) {
  try {
    const identity=await requireAdmin(request,readAdminConfig(process.env));
    const {env}=await getCloudflareContext({async:true}),storage=env as unknown as FontStorage;
    const query=new URL(request.url).searchParams,id=query.get('id');
    if(request.method==='GET') {
      if(id){const {bytes}=await fontBytes(storage,identity.subject,id);return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'font/woff2'}});}
      const result=await storage.UPLOADS.prepare('SELECT id,family,weight,style,sha256,size,status FROM designer_fonts WHERE owner = ? ORDER BY createdAt DESC LIMIT 101').bind(identity.subject).all();
      return Response.json({fonts:result.results},{headers});
    }
    await requireWriteAllowance(storage.UPLOADS,identity.subject,query.get('action')==='publish'?'publication':'uploads');
    if(query.get('action')==='publish') {
      if(process.env.PUBLICATION_ENABLED!=='true'||query.get('confirmed')!=='1')throw new UploadError(403,'请明确确认字体发布。');
      const font=await publishFont(storage,identity.subject,id);return Response.json({font:{id:font.id,family:font.family,weight:font.weight,style:font.style,sha256:font.sha256,status:font.status}},{headers});
    }
    if(query.get('rights')!=='1'||!id||request.headers.get('content-type')!=='font/woff2')throw new UploadError(400,'请确认字体网站使用权限并选择 WOFF2。');
    const reader=request.body?.getReader();if(!reader)throw new UploadError(400,'字体为空。');
    const chunks:Uint8Array[]=[];let length=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>fontByteLimit){await reader.cancel();throw new UploadError(413,'字体超过 5 MiB。');}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const font=await saveFont(storage,identity.subject,id,bytes,Number(query.get('weight')),query.get('style')||'normal',Number(process.env.UPLOAD_QUOTA_BYTES));
    return Response.json({font:{id:font.id,family:font.family,weight:font.weight,style:font.style,sha256:font.sha256,status:font.status}},{headers});
  }catch(error){const status=error instanceof AdminAuthError||error instanceof UploadError?error.status:503;return Response.json({error:status===503?'字体操作未确认，请读回核对。':(error as Error).message},{status,headers:{...headers,...(error instanceof UploadError&&error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})}});}
}
export const GET=handle;export const POST=handle;
