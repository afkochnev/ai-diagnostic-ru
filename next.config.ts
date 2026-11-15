import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/dictation/vosk-model-small-ru-0.22.tar.gz",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/dictation/vosk.worker.js",
        headers: [{
          key: "Content-Security-Policy",
          value: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
        }],
      },
    ];
  },
};

export default nextConfig;
