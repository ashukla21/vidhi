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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Inter for body text, Cinzel for display titles */}
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;800;900&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
