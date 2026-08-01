import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

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
  themeColor: "#0a0a0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
