import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // ali-oss (via urllib) lazily requires the optional `proxy-agent` package,
  // which isn't installed since we don't use an HTTP proxy. Bundling it would
  // make Turbopack try to statically resolve that require and fail — keep it
  // external so Node resolves it natively (and lazily) at runtime instead.
  serverExternalPackages: ["ali-oss"],
};

export default nextConfig;
