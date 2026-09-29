import { createClient } from "@sanity/client";
import { readStudioConfig } from "./studio-config.ts";
import { readPublishedPlacement } from "./published-placement.ts";

export type SlotMedia = { kind: "image" | "video" | "model"; src: string; poster?: string; alt: string; caption: string };

export async function publicSlotMedia(slotId: string): Promise<SlotMedia | null> {
  if (process.env.PUBLIC_MEDIA_ENABLED !== "true") return null;
  const connection = readStudioConfig(process.env);
  if (!connection) return null;
  // Public dataset reads use no token; never reuse the privileged content client.
  const client = createClient({ ...connection, apiVersion: "2026-09-19", perspective: "published", useCdn: false, timeout: 5000, maxRetries: 0 });
  try {
    const content = await readPublishedPlacement(client, slotId);
    if (!content) return null;
    const url = (role: string) => {
      const file = content.variants.find(file => file.role === role);
      return file ? `/api/media?key=${encodeURIComponent(file.key)}` : undefined;
    };
    return { kind: content.kind, src: url(content.kind === "image" ? "detail" : "video")!,
      ...(content.kind === "video" ? { poster: url("poster") } : {}), alt: content.placement.alt, caption: content.placement.caption };
  } catch { return null; } // Preserve the explicit placeholder if content is unavailable/invalid.
}
