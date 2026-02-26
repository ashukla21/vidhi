import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vidhi — Vedic Astrology Investment AI",
  description: "Vedic astrology-powered investment analysis with Claude AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
