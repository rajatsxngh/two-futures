import path from "node:path";
import type { NextConfig } from "next";

// The browser only ever talks to Next. Next forwards /api/* to FastAPI, so
// there's no CORS in the browser and API keys stay on the server.
// Next's own /api routes (e.g. a future ElevenLabs signed-URL route) win over
// this rewrite, because rewrites() returning an array runs after file routes.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // The repo root has its own package-lock.json (for `npm run dev`); pin the app root here.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
