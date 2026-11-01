import type { Metadata } from "next";
import { Pixelify_Sans, VT323 } from "next/font/google";
import "./globals.css";

const head = Pixelify_Sans({ subsets: ["latin"], weight: ["500", "600"], variable: "--f-head" });
const mono = VT323({ subsets: ["latin"], weight: "400", variable: "--f-mono" });

export const metadata: Metadata = {
  title: "TAINT: allowlists check where money goes, TAINT checks who decided",
  description: "A provenance-gated wallet for AI agents on NEAR testnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${head.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
