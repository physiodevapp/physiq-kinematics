import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/physiq/kinematics',
  assetPrefix: '/physiq/kinematics/',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  turbopack: {
    resolveAlias: {
      '@mediapipe/pose': './mocks/mediapipe-pose.js',
    },
  },
};

export default nextConfig;
