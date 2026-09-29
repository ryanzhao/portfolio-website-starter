import { getCloudflareContext } from "@opennextjs/cloudflare";
import { contentClient } from "@/lib/content-client";
import { handleHistory } from "@/lib/history-http";
import type { restorePlacementDraft } from "@/lib/placement-recovery";

export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return handleHistory(request, process.env, async () => {
    const { env } = await getCloudflareContext({ async: true });
    return { storage: env as unknown as Parameters<typeof restorePlacementDraft>[0], client: contentClient(process.env) };
  });
}
export const GET = handle;
export const POST = handle;
