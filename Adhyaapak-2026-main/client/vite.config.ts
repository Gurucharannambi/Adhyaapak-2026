import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser talks to one origin; the dev server forwards API calls to Express.
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } },
  },
  // `npm run preview` serves the production build (with the service worker) for testing offline behaviour.
  preview: { port: 4173, proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } } },
});
