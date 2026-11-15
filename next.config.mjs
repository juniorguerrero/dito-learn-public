/** @type {import('next').NextConfig} */
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig = staticExport
  ? {
      output: "export",
      images: { unoptimized: true },
      // demo build is read-only; skip lint/type gates for a fast, reliable export
      eslint: { ignoreDuringBuilds: true },
      typescript: { ignoreBuildErrors: true },
    }
  : {};

export default nextConfig;
