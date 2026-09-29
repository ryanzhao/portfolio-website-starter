import { getCloudflareContext } from "@opennextjs/cloudflare";
import { handleUploadRequest, type UploadStorage } from "@/lib/upload-http";

export const dynamic = "force-dynamic";

export const GET = POST;

export async function POST(request: Request) {
  return handleUploadRequest(request, process.env, async () => {
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as UploadStorage;
  });
}
