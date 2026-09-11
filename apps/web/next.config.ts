import type { NextConfig } from "next";

const checkerOrigin = process.env.CHECKER_ORIGIN ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["model-viewer"],
  // Same-origin API so the viewer can stream IFC bytes without CORS preflights.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${checkerOrigin}/api/:path*` }];
  },
};

export default nextConfig;
