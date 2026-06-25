/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three.js ships ESM; transpile drei/fiber for safe SSR builds
  transpilePackages: ["three"],
};

export default nextConfig;
