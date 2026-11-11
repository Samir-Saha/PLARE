import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Archivo } from "next/font/google";
import "./globals.css";

// Display face for headings and big numbers: Archivo, set semi-condensed via its width axis. Body text stays Geist.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });

export const metadata: Metadata = {
  title: "PLARE",
  description: "Tasks, submissions, and shared schedules for any group that has to get things done together.",
  // Lets iPhone users "Add to Home Screen" and open PLARE full-screen like an app.
  appleWebApp: { capable: true, title: "PLARE", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#07111f" },
  ],
};

// Applies the saved theme before paint so there's no flash.
const themeScript = `try{var t=localStorage.getItem("plare.theme");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${archivo.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
