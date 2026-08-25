import type { Metadata } from "next";

export const metadata: Metadata = { title: "Idea Radar" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
