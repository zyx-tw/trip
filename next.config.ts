import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // The image runs .next/standalone with node; see Dockerfile.
  output: "standalone",
}

export default nextConfig
