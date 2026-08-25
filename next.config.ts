import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
  // Загрузка изображений (материалы, обложки проектов) через Server Actions:
  // тело multipart-запроса может превышать дефолтный лимит 1MB.
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  // Настройка проксирования внешних запросов или микросервисов
  async rewrites() {
    return [
      {
        source: "/api/auth/:path*",
        destination: "/api/auth/:path*", // Внутренний роут Auth.js
      },
    ];
  },
};

export default nextConfig;
