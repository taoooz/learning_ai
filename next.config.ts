import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本地调试常用 host；避免 127.0.0.1 ↔ localhost 触发 dev 跨源资源警告
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
