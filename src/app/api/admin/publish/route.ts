import { getCloudflareContext } from "@opennextjs/cloudflare";
import { contentClient } from "@/lib/content-client";
import { handlePublication } from "@/lib/publication-http";
import type { publishPlacement } from "@/lib/publish-placement";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handlePublication(request, process.env, async () => {
    const { env } = await getCloudflareContext({ async: true });
    return { storage: env as unknown as Parameters<typeof publishPlacement>[0], client: contentClient(process.env) };
  });
}
