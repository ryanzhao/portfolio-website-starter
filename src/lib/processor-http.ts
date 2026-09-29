import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { AdminAuthError } from "./admin-auth.ts";
import { requireProcessor } from "./processor-auth.ts";
import { readAdminJson } from "./upload-http.ts";
import { UploadError } from "./uploads.ts";
import { claimProcessingJob, renewProcessingLease, processingSource, registerProcessingResult, completeProcessing, failProcessing } from "./processing.ts";
import { MediaValidationError } from "./media.ts";
import { signResultUpload } from "./result-signing.ts";

export async function handleProcessorRequest(request: Request, env: Record<string, string | undefined>,
  storage: () => Promise<{ UPLOADS: D1Database; ORIGINALS?: R2Bucket }>) {
  const headers = { "Cache-Control": "no-store" };
  try {
    requireProcessor(request, env);
    if (request.method !== "POST") throw new UploadError(405, "不支持此请求方法。");
    const body = await readAdminJson(request) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new UploadError(400, "任务请求无效。");
    const { action, assetId, leaseToken } = body;
    const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
    const allowed = ["action", "assetId", "leaseToken", ...(action === "source" ? ["offset","length"] : []), ...(action === "register" ? ["result"] : []), ...(action === "fail" ? ["error"] : []), ...(action === "authorize-result" ? ["role"] : [])];
    if (action === "claim" ? Object.keys(body).length !== 1 :
      typeof action !== "string" || !["renew", "source", "register", "authorize-result", "complete", "fail"].includes(action) || Object.keys(body).some(key => !allowed.includes(key)) || !uuid(assetId) || !uuid(leaseToken)) {
      throw new UploadError(400, "任务请求字段无效。");
    }
    const { UPLOADS: db, ORIGINALS: bucket } = await storage();
    if (!db) throw new UploadError(503, "任务存储尚未配置。");
    if (action === "fail") return Response.json(await failProcessing(db, assetId as string, leaseToken as string, body.error), { headers });
    if (action === "complete") {
      if (!bucket) throw new UploadError(503, "衍生文件存储尚未配置。");
      return Response.json({ job: await completeProcessing(db, bucket, assetId as string, leaseToken as string), published: false }, { headers });
    }
    if (action === "authorize-result") {
      return Response.json(await signResultUpload(db, assetId as string, leaseToken as string, body.role, env), { headers });
    }
    if (action === "register") {
      const result = await registerProcessingResult(db, assetId as string, leaseToken as string, body.result);
      return Response.json({ result, ready: false }, { headers });
    }
    if (action === "source") {
      if (!bucket) throw new UploadError(503, "原文件存储尚未配置。");
      const range=body.offset!==undefined||body.length!==undefined?{offset:body.offset as number,length:body.length as number}:undefined;
      const object = await processingSource(db, bucket, assetId as string, leaseToken as string,Date.now(),range);
      const length=range?Math.min(range.length,object.size-range.offset):object.size;
      return new Response(object.body as unknown as ReadableStream, { status:range?206:200,headers: {
        ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(length),
        ...(range?{"Content-Range":`bytes ${range.offset}-${range.offset+length-1}/${object.size}`} : {}),
        "X-Source-Size": String(object.size), // Preserve exact size when the edge uses chunked transfer.
        "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff",
      } });
    }
    const job = action === "claim" ? await claimProcessingJob(db)
      : await renewProcessingLease(db, assetId as string, leaseToken as string);
    return Response.json({ job }, { headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError || error instanceof UploadError;
    return Response.json({ error: expected || error instanceof MediaValidationError ? error.message : "处理服务暂时不可用。" }, {
      status: expected ? error.status : error instanceof MediaValidationError ? 400 : 503, headers,
    });
  }
}
