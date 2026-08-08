import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "perceptual-commerce",
  description: "The perception layer for agentic commerce — bounded spend, gated fail-closed onchain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Forced dark: this is a control surface shown on a projector, and a light
    // theme washes out the status colours that carry the meaning.
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
