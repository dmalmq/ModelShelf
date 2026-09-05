/** @type {import('next').NextConfig} */
const checkerOrigin = process.env.CHECKER_ORIGIN ?? "http://127.0.0.1:8787";

const nextConfig = {
  reactStrictMode: true,
  // Same-origin API so the viewer can stream IFC bytes without CORS preflights.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${checkerOrigin}/api/:path*` }];
  },
};

export default nextConfig;
