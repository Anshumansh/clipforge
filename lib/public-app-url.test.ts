import { afterEach, describe, expect, it } from "vitest";
import { getPublicAppOrigin } from "./public-app-url";

const original = process.env.NEXTAUTH_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = original;
});

describe("getPublicAppOrigin", () => {
  it("prefers the configured public URL over request headers", () => {
    process.env.NEXTAUTH_URL = "https://forgecut.app";
    expect(getPublicAppOrigin("https://attacker.example/api/stripe/checkout")).toBe("https://forgecut.app");
  });

  it("falls back to the request origin in local development", () => {
    delete process.env.NEXTAUTH_URL;
    expect(getPublicAppOrigin("http://localhost:3000/api/stripe/checkout")).toBe("http://localhost:3000");
  });
});
