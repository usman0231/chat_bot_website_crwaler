import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },

  allowedDevOrigins: ["192.168.1.84"],
};

export default nextConfig;