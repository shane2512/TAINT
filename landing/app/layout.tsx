import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--f-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono" });

export const metadata: Metadata = {
  title: "TAINT: allowlists check where money goes, TAINT checks who decided",
  description: "A provenance-gated wallet for AI agents on NEAR testnet.",
  metadataBase: new URL("https://taint-site.vercel.app"),
  openGraph: { title: "TAINT: who decided?", description: "A provenance-gated wallet for AI agents on NEAR testnet.", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
