import { AdminAuthError, readAdminConfig, requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await requireAdmin(request, readAdminConfig(process.env));
    return Response.json({ authenticated: true, email: identity.email }, { headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError;
    return Response.json({ authenticated: false, error: expected ? error.message : "身份验证服务暂时不可用。" }, {
      status: expected ? error.status : 503, headers,
    });
  }
}
