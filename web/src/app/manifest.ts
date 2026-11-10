import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PLARE",
    short_name: "PLARE",
    description: "Tasks, submissions, and shared schedules for your group.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#e9eef5",
    theme_color: "#0e2747",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
