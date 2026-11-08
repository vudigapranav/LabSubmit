/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Turns off the /_next/image optimisation endpoint. Next 14.x has unpatched critical
  // advisories in that endpoint (SECURITY_AUDIT.md S8), and the only images here are local
  // logos that need no resizing, so serving them as-is costs nothing.
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ['bcryptjs', 'jsonwebtoken']
  }
};

export default nextConfig;
