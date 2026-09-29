import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import { handleProcessorRequest } from "@/lib/processor-http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleProcessorRequest(request, process.env, async () => {
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as { UPLOADS: D1Database };
  });
}
