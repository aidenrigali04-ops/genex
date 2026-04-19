import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, Inter } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
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
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${instrumentSans.variable} dark h-full font-sans antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ada-app text-ada-primary">
        {children}
        <Toaster richColors closeButton theme="dark" />
      </body>
    </html>
  );
}
