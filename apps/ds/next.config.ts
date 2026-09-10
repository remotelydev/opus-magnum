import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@opus-magnum/ui"],
};

export default nextConfig;
