/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version to scanners.
  poweredByHeader: false,
  // Security headers on every response (SECURITY_AUDIT.md S17). Deliberately NOT a full
  // script-restricting CSP: Monaco loads from a CDN and Next injects inline scripts, so a
  // strict policy would break the exam IDE and a loose one would be theatre.
  // frame-ancestors / X-Frame-Options stop clickjacking (e.g. a page tricking a lecturer
  // into clicking "Save evaluation" inside a hidden frame).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
  // Turns off the /_next/image optimisation endpoint. Next 14.x has unpatched critical
  // advisories in that endpoint (SECURITY_AUDIT.md S8), and the only images here are local
  // logos that need no resizing, so serving them as-is costs nothing.
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ['bcryptjs', 'jsonwebtoken']
  }
};

export default nextConfig;
