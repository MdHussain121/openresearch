/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Next.js 15 expects hostnames (with optional port), NOT full URLs.
  // e.g. '192.168.1.9' or '192.168.1.9:3000' — 'http://...' is ignored.
  allowedDevOrigins: [
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
    '192.168.1.9',
    '192.168.1.9:3000',
    // allow any host on 192.168.1.x for LAN testing (phone/tablet)
    '192.168.1.*',
    // also honour explicit env var (strip http:// if user provided URLs)
    ...((process.env.ALLOWED_DEV_ORIGINS?.split(',') ?? [])
      .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''))
      .filter(Boolean)),
  ],
  transpilePackages: [
    '@openresearch/tokens',
    '@openresearch/editor',
    '@openresearch/citations',
    '@openresearch/ai',
    '@openresearch/plugins',
    '@openresearch/ui',
  ],
};

module.exports = nextConfig;
