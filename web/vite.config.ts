import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 4319,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4318", "/v1": "http://127.0.0.1:4318" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
