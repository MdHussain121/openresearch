/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS?.split(',') ?? []).filter(Boolean),
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
