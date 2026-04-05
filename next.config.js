/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable Turbopack for build (use webpack)
  experimental: {
    turbo: undefined,
  },
};

module.exports = nextConfig;
