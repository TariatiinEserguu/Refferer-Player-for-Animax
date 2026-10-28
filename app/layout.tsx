import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Referer Player",
  description: "Play Playmax / Animax videos through a Referer-aware proxy",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="mn">
      <body>{children}</body>
    </html>
  );
}
