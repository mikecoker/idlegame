import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 4321,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  preview: {
    port: 4321,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
});
