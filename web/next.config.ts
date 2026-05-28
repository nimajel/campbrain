import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow webpack to resolve .js imports as .ts files
  // This is needed because src/ uses ESM-style .js extensions pointing to .ts sources
  webpack(config) {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
