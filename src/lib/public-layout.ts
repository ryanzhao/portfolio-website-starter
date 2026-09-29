import { createClient } from "@sanity/client";
import { readStudioConfig } from "./studio-config.ts";
import { emptyPageLayout } from "./page-layout.ts";
import { readPublishedLayout } from "./layout-store.ts";

// Never use the privileged draft client on visitor pages.
export async function publicPageLayout() {
  const connection = readStudioConfig(process.env);
  if (!connection) return emptyPageLayout();
  const client = createClient({ ...connection, apiVersion: "2026-09-19", perspective: "published", useCdn: false, timeout: 5000, maxRetries: 0 });
  try { return await readPublishedLayout(client); }
  catch { return emptyPageLayout(); }
}
