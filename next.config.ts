import type { NextConfig } from "next";
import { readStudioConfig } from "./src/lib/studio-config.ts";

const config: NextConfig = {
  // Keep page generation within this PC's memory budget.
  experimental: { cpus: 2 },
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    const studio = readStudioConfig(process.env);
    const account = process.env.R2_ACCOUNT_ID;
    const policy = `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
    const studioPolicy = studio ? policy
      .replace("connect-src 'self' data:", `connect-src 'self' data: https://api.sanity.io https://${studio.projectId}.api.sanity.io https://${studio.projectId}.apicdn.sanity.io wss://${studio.projectId}.api.sanity.io`)
      .replace("img-src 'self' data: blob:", "img-src 'self' data: blob: https://cdn.sanity.io")
      .replace("font-src 'self'", "font-src 'self' https://design-system-static.sanity.io")
      + `; frame-src https://api.sanity.io https://${studio.projectId}.api.sanity.io; worker-src 'self' blob:` : policy;
    const uploadPolicy = account && /^[a-f0-9]{32}$/.test(account)
      ? policy.replace("connect-src 'self' data:", `connect-src 'self' data: https://${account}.r2.cloudflarestorage.com`) : policy;
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: policy }
    ] }, { source: "/admin", headers: [{ key: "Content-Security-Policy", value: uploadPolicy }] },
    { source: "/admin/advanced", headers: [{ key: "Content-Security-Policy", value: uploadPolicy }] },
    { source: "/admin/design", headers: [{ key: "Content-Security-Policy", value: uploadPolicy }] },
    { source: "/admin/studio/:path*", headers: [{ key: "Content-Security-Policy", value: studioPolicy }] }];
  }
};
export default config;
