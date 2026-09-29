export const dynamic = "force-dynamic";
export function GET() { return Response.json({ status: "ok", phase: 1, cms: "not-connected", storage: "not-connected" }, { headers: { "Cache-Control": "no-store" } }); }
