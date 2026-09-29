import { open } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

// Only for the processor API, never for signed R2 uploads.
export function processorHeaders(origin, token, access = {}) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (access.clientId || access.clientSecret) {
    if (!origin.startsWith("https://") || !/^[a-f0-9]{32}\.access$/.test(access.clientId ?? "") ||
      !/^cfast_[A-Za-z0-9_-]{40,100}$/.test(access.clientSecret ?? "")) throw new Error("Access 服务凭据必须完整有效，并使用 HTTPS。");
    headers["CF-Access-Client-Id"] = access.clientId;
    headers["CF-Access-Client-Secret"] = access.clientSecret;
  }
  return headers;
}

// Failed partial files are retained in the private job directory; never process them.
export async function downloadSource(origin, token, job, destination, options = {}) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))) {
    throw new Error("处理后台地址必须为 HTTPS 或本机回环地址。");
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("处理密钥格式无效。");
  const headers=processorHeaders(origin,token,options.access),file=await open(destination,"wx");
  let offset=0,total;
  try {
    do {
      let bytes;
      for(let attempt=0;attempt<3;attempt++) {
        options.signal?.throwIfAborted();
        try {
          const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
          const response=await (options.fetch??fetch)(`${origin}/api/processor`,{method:"POST",redirect:"error",signal,headers,
            body:JSON.stringify({action:"source",assetId:job.assetId,leaseToken:job.leaseToken,offset,length:8*1024**2})});
          const declared=Number(response.headers.get("x-source-size")),length=Math.min(8*1024**2,declared-offset);
          if(response.status!==206||!response.body||!Number.isSafeInteger(declared)||declared<1||declared>2*1024**3||length<=0||
            total!==undefined&&declared!==total||response.headers.get("content-range")!==`bytes ${offset}-${offset+length-1}/${declared}`){
            await response.body?.cancel();throw new Error("原文件下载被拒绝或大小无效。");
          }
          total=declared;
          const reader=response.body.getReader(),chunks=[];let received=0;
          try{while(true){const {value,done}=await reader.read();if(done)break;received+=value.length;if(received>length)throw new Error("原文件分段大小超出声明。");chunks.push(value);}}
          finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
          if(received!==length)throw new Error(`原文件下载大小不完整（偏移 ${offset}，收到 ${received}/${length} 字节）。`);
          bytes=Buffer.concat(chunks,received);break;
        }catch(error){if(options.signal?.aborted||attempt===2)throw error;await setTimeout(300,undefined,{signal:options.signal});}
      }
      await file.writeFile(bytes);offset+=bytes.length;
    }while(offset<total);
    return offset;
  }finally{await file.close();}
}
