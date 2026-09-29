import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { R2Bucket } from "@cloudflare/workers-types";
import { handlePublicMedia } from "@/lib/public-media-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handlePublicMedia(request, process.env, async () => {
    const { env } = await getCloudflareContext({ async: true });
    return (env as unknown as { PUBLISHED: R2Bucket }).PUBLISHED;
  });
}
export const HEAD = GET;
