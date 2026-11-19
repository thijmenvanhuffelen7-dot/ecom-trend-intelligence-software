import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@trendscope/db", "@trendscope/core"],
  serverExternalPackages: ["pg", "@clickhouse/client"],
  typedRoutes: false,
  poweredByHeader: false,
  devIndicators: false,
};

export default config;
