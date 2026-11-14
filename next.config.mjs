// Two build targets share one code base:
//   default            -> static export (`out/`), no server, deployable anywhere
//   BUILD_TARGET=selfhost -> standalone Node server incl. the optional sync API
// API route files are named `route.api.ts`; they are only picked up as routes
// in the self-hosted build, because a static export cannot contain them.
const selfhost = process.env.BUILD_TARGET === 'selfhost';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: selfhost ? 'standalone' : 'export',
  pageExtensions: selfhost ? ['tsx', 'ts', 'api.ts'] : ['tsx', 'ts'],
  basePath: basePath || undefined,
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_SELFHOST: selfhost ? '1' : '',
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  serverExternalPackages: ['sharp', '@prisma/client'],
};

export default nextConfig;
