import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The dev server passes the API through to the runner, so the page, its session cookie and
// the event stream share one origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/v1": { target: "http://127.0.0.1:8790" } },
  },
  test: { environment: "jsdom" },
});
