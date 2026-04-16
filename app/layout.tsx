import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Genex — Viral short-form clips",
  description:
    "Upload a video or paste a URL, describe your edit, and get five ready-to-post variations for TikTok, Reels, and Shorts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} font-sans h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#F0EFFE] text-[#0F0A1E] dark:bg-zinc-950 dark:text-zinc-50">
        {children}
        <Toaster richColors closeButton theme="light" />
      </body>
    </html>
  );
}
