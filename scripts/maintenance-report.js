// Builds a plain-text summary from the before/after npm audit + outdated
// JSON snapshots captured by the maintenance workflow. Run with plain node,
// no dependencies — this only runs inside the GitHub Actions job.
const fs = require("fs");

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const auditBefore = readJson("audit-before.json");
const auditAfter = readJson("audit-after.json");
const outdatedAfter = readJson("outdated-after.json") ?? {};
const lockfileChanged = process.argv[2] === "true";
const buildPassed = process.argv[3] === "true";

const lines = [];

lines.push(`Build gate: ${buildPassed ? "PASSED" : "FAILED"}`);
lines.push(
  lockfileChanged && buildPassed
    ? "Safe updates (within existing package.json semver ranges) were applied and pushed to main."
    : "No safe updates were applied this run."
);
lines.push("");

const beforeCount = auditBefore?.metadata?.vulnerabilities?.total ?? 0;
const afterCount = auditAfter?.metadata?.vulnerabilities?.total ?? 0;
lines.push(`npm audit: ${beforeCount} vulnerabilities before -> ${afterCount} after`);

// Packages where "wanted" (highest version npm update would apply) is behind
// "latest" (absolute newest on the registry) need a manual major-version
// bump — npm update deliberately never crosses that boundary on its own.
const needsReview = Object.entries(outdatedAfter).filter(
  ([, info]) => info.wanted !== info.latest
);

if (needsReview.length > 0) {
  lines.push("");
  lines.push(`${needsReview.length} package(s) have a newer major version available (not auto-applied, needs review):`);
  for (const [name, info] of needsReview) {
    lines.push(`  - ${name}: ${info.current} -> ${info.latest} (latest); staying on ${info.wanted}`);
  }
} else {
  lines.push("");
  lines.push("No packages are behind on a major version.");
}

if (afterCount > 0 && auditAfter?.vulnerabilities) {
  const highSeverity = Object.entries(auditAfter.vulnerabilities).filter(([, v]) =>
    ["high", "critical"].includes(v.severity)
  );
  if (highSeverity.length > 0) {
    lines.push("");
    lines.push("High/critical severity advisories still present (likely need a major bump to fix):");
    for (const [name, v] of highSeverity) {
      lines.push(`  - ${name} (${v.severity})`);
    }
  }
}

fs.writeFileSync("report.txt", lines.join("\n") + "\n");
console.log(lines.join("\n"));
