import type { Metadata, Viewport } from "next";
import { Inter, Lexend } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const lexend = Lexend({ subsets: ["latin"], variable: "--font-display", display: "swap" });

const title = "Clipforge — Turn any idea into a scroll-stopping short video";
const description =
  "Clipforge generates short-form video with AI scripts, voiceovers, captions, and b-roll — from a script, a URL, or a long-form upload.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000"),
  title: { default: title, template: "%s · Clipforge" },
  description,
  openGraph: { title, description, siteName: "Clipforge", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#08070c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${lexend.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
