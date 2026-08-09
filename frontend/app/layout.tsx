import type { Metadata, Viewport } from "next";
import { Archivo, Azeret_Mono, Silkscreen } from "next/font/google";
import "./globals.css";

/**
 * Silkscreen is a bitmap face and renders true only at its integer size steps;
 * every use of it in globals.css is locked to one. Archivo carries text and
 * data, Azeret Mono carries hashes and identifiers, where telling 0 from O is
 * the whole job.
 */
const display = Silkscreen({ variable: "--font-silkscreen", weight: ["400", "700"], subsets: ["latin"] });
const text = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const mono = Azeret_Mono({ variable: "--font-azeret", subsets: ["latin"] });

const CONTRACT = `<!--
THESIS: a machine's crude sight, printed at poster scale beside the contract that can refuse it.
  Refuses the agent-dashboard rut: glass cards on near-black with a neon accent.
OWN-WORLD: newsprint #F5F3EC, rich black #0A0A0A, one accent #FF5A3C used only as a filled field,
  never as text on paper. Silkscreen bitmap display at integer sizes, Archivo text, Azeret Mono data.
  Square corners, 2px ink rules, halftone and dot-matrix as real imaging surfaces.
STORY: a live frame is reduced down a visible chain to 108 numbers; the ruling turns on those
  numbers; the gate permits or refuses, and a refusal reads as the system working.
FIRST VIEWPORT: ink masthead carrying the three planes. Three ruled panels below: the sight
  (screened frame, reduction chain, divergence meter, submit), the gate (ruling stamp, contract
  facts, two refusals), the record. Colophon strip closes the sheet.
FORM: Emigre Bitmap Specimen, taken by the user over assigned grounded direction 6, the picture
  desk. Seed key 2eab50ae.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
  verdict, and DESIGN.md
-->`;

export const metadata: Metadata = {
  title: "tessr",
  description:
    "The perception layer for agentic commerce. A vision model watches a real scene and proposes a payment the moment a condition becomes true, and an onchain contract on Monad decides whether the card may exist at all.",
  openGraph: {
    title: "tessr",
    siteName: "tessr",
    description:
      "The perception layer for agentic commerce. Perception proposes, an onchain contract authorizes, and every ambiguity is a deny.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${text.variable} ${mono.variable}`}>
        <div hidden aria-hidden dangerouslySetInnerHTML={{ __html: CONTRACT }} />
        {children}
      </body>
    </html>
  );
}
