import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  // Migrations run on first DB use; ship the SQL files with every server route.
  outputFileTracingIncludes: { '/**': ['./drizzle/**/*'] },
};

export default nextConfig;
