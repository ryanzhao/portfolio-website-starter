export type StudioConnection = { projectId: string; dataset: string };

// Only these two non-secret values may cross into the Studio client component.
export function readStudioConfig(env: Record<string, string | undefined>): StudioConnection | null {
  const projectId = env.SANITY_PROJECT_ID || "";
  const dataset = env.SANITY_DATASET || "";
  if (!/^[a-z0-9]{1,32}$/.test(projectId) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(dataset)) return null;
  return { projectId, dataset };
}
