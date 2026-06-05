/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["maplibre-gl"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/api/rainviewer",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=600",
          },
        ],
      },
      {
        source: "/api/rainviewer/tiles/:path*",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/models/:path*.vrm",
        headers: [
          { key: "Content-Type", value: "model/gltf-binary" },
          {
            key: "Cache-Control",
            value:
              process.env.NODE_ENV === "development"
                ? "no-store"
                : "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
