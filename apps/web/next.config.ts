import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@trendscope/db", "@trendscope/core"],
  serverExternalPackages: ["pg", "@clickhouse/client"],
  typedRoutes: false,
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/v1/openapi.json", destination: "/api/v1/openapi" }];
  },
};

export default config;
