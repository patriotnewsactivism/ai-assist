// vite.config.ts
import { defineConfig } from "file:///sessions/happy-confident-carson/mnt/ai-assist/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/happy-confident-carson/mnt/ai-assist/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true
    // Skip TS type checking during build — esbuild handles transpilation only
    // Run tsc separately if you want type validation
  },
  esbuild: {
    // Do not fail on type errors — just transpile
    logOverride: { "this-is-undefined-in-esm": "silent" }
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvaGFwcHktY29uZmlkZW50LWNhcnNvbi9tbnQvYWktYXNzaXN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvaGFwcHktY29uZmlkZW50LWNhcnNvbi9tbnQvYWktYXNzaXN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9oYXBweS1jb25maWRlbnQtY2Fyc29uL21udC9haS1hc3Npc3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcclxuICBidWlsZDoge1xyXG4gICAgb3V0RGlyOiBcImRpc3RcIixcclxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxyXG4gICAgLy8gU2tpcCBUUyB0eXBlIGNoZWNraW5nIGR1cmluZyBidWlsZCBcdTIwMTQgZXNidWlsZCBoYW5kbGVzIHRyYW5zcGlsYXRpb24gb25seVxyXG4gICAgLy8gUnVuIHRzYyBzZXBhcmF0ZWx5IGlmIHlvdSB3YW50IHR5cGUgdmFsaWRhdGlvblxyXG4gIH0sXHJcbiAgZXNidWlsZDoge1xyXG4gICAgLy8gRG8gbm90IGZhaWwgb24gdHlwZSBlcnJvcnMgXHUyMDE0IGp1c3QgdHJhbnNwaWxlXHJcbiAgICBsb2dPdmVycmlkZTogeyBcInRoaXMtaXMtdW5kZWZpbmVkLWluLWVzbVwiOiBcInNpbGVudFwiIH0sXHJcbiAgfSxcclxuICBzZXJ2ZXI6IHtcclxuICAgIHByb3h5OiB7XHJcbiAgICAgIFwiL2FwaVwiOiB7XHJcbiAgICAgICAgdGFyZ2V0OiBcImh0dHA6Ly9sb2NhbGhvc3Q6NTAwMFwiLFxyXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgfSxcclxufSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBNFQsU0FBUyxvQkFBb0I7QUFDelYsT0FBTyxXQUFXO0FBRWxCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixhQUFhO0FBQUE7QUFBQTtBQUFBLEVBR2Y7QUFBQSxFQUNBLFNBQVM7QUFBQTtBQUFBLElBRVAsYUFBYSxFQUFFLDRCQUE0QixTQUFTO0FBQUEsRUFDdEQ7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
