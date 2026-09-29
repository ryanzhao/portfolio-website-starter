import { getCloudflareContext } from "@opennextjs/cloudflare";
import { handlePrivatePreview } from "@/lib/private-preview-http";
import type { UploadStorage } from "@/lib/upload-http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handlePrivatePreview(request, process.env, async () => {
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as UploadStorage;
  });
}
