// next.config.ts
import type { NextConfig } from "next";
import { getProductionSecurityHeaders } from "./lib/security/http-hardening";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: getProductionSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;