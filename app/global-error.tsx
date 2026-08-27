"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Next.js only invokes this for an error thrown in the root layout itself --
// every other page/route already reports through instrumentation.ts
// (server) or the SDK's automatic client-side hook (browser). This exists
// specifically to catch that one remaining gap, per Sentry's own Next.js
// integration guidance.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" }}>
          <div>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
            <p style={{ marginTop: "0.5rem", color: "#666" }}>We&apos;ve been notified and are looking into it.</p>
          </div>
        </div>
      </body>
    </html>
  );
}
