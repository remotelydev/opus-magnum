import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(appDir, "../..");

loadEnv({ path: path.join(repoRoot, ".env"), quiet: true });
loadEnv({ path: path.join(repoRoot, ".env.local"), quiet: true });
loadEnv({ path: path.join(appDir, ".env"), quiet: true });
loadEnv({ path: path.join(appDir, ".env.local"), override: true, quiet: true });

const nextConfig: NextConfig = {
  agentRules: false,
};

export default nextConfig;
