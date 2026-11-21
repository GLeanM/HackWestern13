import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Browser calls /api on the same origin; Vite forwards to the Express API.
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3001}` },
  },
});
