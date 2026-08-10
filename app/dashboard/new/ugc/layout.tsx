import type { Metadata } from "next";

export const metadata: Metadata = { title: "UGC ad" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
