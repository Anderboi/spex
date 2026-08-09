import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
