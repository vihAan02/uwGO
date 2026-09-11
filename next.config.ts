import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  // The landing page was previewed at /landing before it became the site root.
  async redirects() {
    return [{ source: "/landing", destination: "/", permanent: true }];
  },
};

export default nextConfig;
