import { getCloudflareContext } from "@opennextjs/cloudflare";
import { handleAssetLibrary } from "@/lib/asset-library-http";
import type { UploadStorage } from "@/lib/upload-http";

export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return handleAssetLibrary(request, process.env, async () => {
    const { env } = await getCloudflareContext({ async: true });
    return (env as unknown as UploadStorage).UPLOADS;
  });
}
export const GET = handle;
export const POST = handle;
