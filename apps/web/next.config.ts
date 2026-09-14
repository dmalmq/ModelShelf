import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const checkerOrigin = process.env.CHECKER_ORIGIN ?? "http://127.0.0.1:8787";

/**
 * Production keeps Next's default page extensions. `next dev` additionally
 * treats `page.dev.tsx` as a page, so a gallery is a route on a developer's
 * machine and a colocated file in `next build`. `scripts/check-routes.mjs`
 * asserts the resulting route table after every build.
 */
const PRODUCTION_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
const DEV_ONLY_PAGE_EXTENSION = "dev.tsx";

export default function nextConfig(phase: string): NextConfig {
  return {
    pageExtensions:
      phase === PHASE_DEVELOPMENT_SERVER
        ? [DEV_ONLY_PAGE_EXTENSION, ...PRODUCTION_PAGE_EXTENSIONS]
        : PRODUCTION_PAGE_EXTENSIONS,
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
}
