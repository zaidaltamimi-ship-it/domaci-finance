import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// POZOR: base musí odpovídat názvu GitHub repozitáře!
// Appka pak poběží na https://<uzivatel>.github.io/domaci-finance/
export default defineConfig({
  base: "/domaci-finance/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Domácí finance",
        short_name: "Finance",
        description: "Domácí účetní kniha – příjmy, výdaje, rozpočty a spoření",
        lang: "cs",
        start_url: "/domaci-finance/",
        scope: "/domaci-finance/",
        display: "standalone",
        background_color: "#F4F6F2",
        theme_color: "#1C2B27",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
});
