import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

const getServerSession = vi.fn();

vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const { SiteHeader } = await import("./site-header");

/** No renderer is set up in this project's test suite (see other .test.tsx
 * files) -- React elements are plain objects, so walk the tree directly
 * looking for an <a href> whose text matches, which is exactly what a real
 * user sees regardless of styling. */
function findLinks(node: ReactNode, out: { href: string; text: string }[] = []): { href: string; text: string }[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) findLinks(child, out);
    return out;
  }
  const el = node as ReactElement<{ href?: string; children?: ReactNode }>;
  if (el.props?.href) {
    const text = flattenText(el.props.children);
    out.push({ href: el.props.href, text });
  }
  if (el.props?.children) findLinks(el.props.children, out);
  return out;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return flattenText((node as ReactElement<{ children?: ReactNode }>).props?.children);
  }
  return "";
}

// Regression coverage for a real bug: this header used to show "Log in" /
// "Start free" unconditionally, with no way for an already-authenticated
// visitor to tell the header didn't know about their session -- clicking
// "Log in" landed them on a login form that looked exactly like being
// signed out, even though the session was untouched.
describe("SiteHeader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a Dashboard link, not Log in / Start free, when a session exists", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user_1" } });
    const result = await SiteHeader();
    const links = findLinks(result);

    expect(links).toContainEqual({ href: "/dashboard", text: "Dashboard" });
    expect(links.some((l) => l.href === "/login")).toBe(false);
    expect(links.some((l) => l.href === "/register")).toBe(false);
  });

  it("shows Log in / Start free, not Dashboard, when there is no session", async () => {
    getServerSession.mockResolvedValue(null);
    const result = await SiteHeader();
    const links = findLinks(result);

    expect(links).toContainEqual({ href: "/login", text: "Log in" });
    expect(links).toContainEqual({ href: "/register", text: "Start free" });
    expect(links.some((l) => l.href === "/dashboard")).toBe(false);
  });
});
