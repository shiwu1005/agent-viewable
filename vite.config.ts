import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 部署时改成 '/<repo>/'
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5180,
    watch: {
      usePolling: true,
      interval: 400,
      ignored: ["**/node_modules/**", "**/.git/**", "**/.*.tmp*/**"],
    },
  },
  build: { target: "es2020" },
});
