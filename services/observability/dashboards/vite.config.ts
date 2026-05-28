import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发期：vite dev → :4400，/api/* 代理到本地 server.mjs（:4401）
// 生产期：vite build → server.mjs 同时贴静态资源 + 提供 /api/*
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4400,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4401",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: true
  }
});
