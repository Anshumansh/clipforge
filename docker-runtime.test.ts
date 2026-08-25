import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production image runtime dependencies", () => {
  const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");

  it("ships both Remotion's scoped packages and its public runtime package", () => {
    expect(dockerfile).toContain(
      "COPY --from=builder /app/node_modules/@remotion ./node_modules/@remotion"
    );
    expect(dockerfile).toContain(
      "COPY --from=builder /app/node_modules/remotion ./node_modules/remotion"
    );
  });
});
