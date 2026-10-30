/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: all audio work runs in the browser, so no Next server ships.
  // This also keeps Next 14's server-side advisories (RSC, rewrites, image
  // optimizer) out of the deployed surface.
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
