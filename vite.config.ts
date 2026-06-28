import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Skip TS type checking during build — esbuild handles transpilation only
    // Run tsc separately if you want type validation
  },
  esbuild: {
    // Do not fail on type errors — just transpile
    logOverride: { "this-is-undefined-in-esm": "silent" },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
