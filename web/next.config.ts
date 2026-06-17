import path from 'path';
import { existsSync, readFileSync } from 'fs';
import type { NextConfig } from 'next';

// Load the root .env so DATABASE_URL is available to the Next.js server process.
// Next.js only auto-loads .env from web/ — this bridges the gap for the monorepo layout.
const rootEnvPath = path.resolve(__dirname, '../.env');
if (existsSync(rootEnvPath)) {
  for (const line of readFileSync(rootEnvPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !(match[1]! in process.env)) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
    }
  }
}

const nextConfig: NextConfig = {
  // The floating dev-tools indicator covers the map legend (bottom-left).
  devIndicators: false,
  // Allow webpack to resolve .js imports as .ts files
  // This is needed because src/ uses ESM-style .js extensions pointing to .ts sources
  webpack(config, { dev }) {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    // A stale .next/cache/webpack/*-production cache can poison the build:
    // webpack-runtime.js resolves chunks at ./NNN.js while they are emitted to
    // ./chunks/NNN.js, so pages 500 under `next start` even though build exits 0.
    // Disable the persistent cache for production builds (dev keeps its cache).
    if (config.cache && !dev) {
      config.cache = Object.freeze({ type: 'memory' });
    }
    return config;
  },
};

export default nextConfig;
