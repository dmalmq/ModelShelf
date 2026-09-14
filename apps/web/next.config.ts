import type { NextConfig } from "next";

const checkerOrigin = process.env.CHECKER_ORIGIN ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["model-viewer", "@modelshelf/model-contracts"],
  webpack: (config) => {
    // NodeNext specifiers in @modelshelf/model-contracts end in .js. Webpack must resolve those to .ts source.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  // Same-origin API so the viewer can stream IFC bytes without CORS preflights.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${checkerOrigin}/api/:path*` }];
  },
};

export default nextConfig;
