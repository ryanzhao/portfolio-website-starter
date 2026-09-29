import { AdminAuthError, readAdminConfig, requireAdmin } from "@/lib/admin-auth";
import { mediaSlots, uploadLimits } from "@/lib/media";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    await requireAdmin(request, readAdminConfig(process.env));
    return Response.json({ slots: mediaSlots, limits: uploadLimits }, { headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError;
    return Response.json({ error: expected ? error.message : "管理服务暂时不可用。" }, {
      status: expected ? error.status : 503, headers,
    });
  }
}
