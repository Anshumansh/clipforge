// Scenario A (section 19): 100 concurrent users browsing public pages for a
// 30-minute soak. Never touches an authenticated route or submits a
// generation -- purely public, cacheable content. See tests/load/README.md
// before running this against anything.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const PUBLIC_PATHS = [
  "/",
  "/pricing",
  "/how-it-works",
  "/trust",
  "/privacy",
  "/terms",
  "/contact",
  "/changelog",
  "/roadmap",
  "/for/agencies",
  "/for/ecommerce",
  "/for/podcasters",
  "/vs/opus-clip",
  "/vs/revid-ai",
];

export const options = {
  scenarios: {
    soak: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 100 }, // ramp
        { duration: "26m", target: 100 }, // soak
        { duration: "2m", target: 0 }, // ramp down
      ],
    },
  },
  thresholds: {
    // Section 2's public-page target.
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"], // error rate < 1%
    // Health endpoint gets its own, tighter target -- checked separately
    // below via a tagged request.
    "http_req_duration{endpoint:health}": ["p(95)<200"],
  },
};

export default function publicBrowsingScenario() {
  const path = PUBLIC_PATHS[Math.floor(Math.random() * PUBLIC_PATHS.length)];
  const res = http.get(`${BASE_URL}${path}`);

  check(res, {
    "status is 200": (r) => r.status === 200,
    // No private data belongs on a public page -- a cheap, generic guard
    // against an authenticated fragment leaking into a public response.
    "no session cookie set on a public GET": (r) => !r.headers["Set-Cookie"],
  });

  // Health probe, tagged separately so its own tighter p95 threshold above
  // is measured independent of the heavier marketing pages.
  const health = http.get(`${BASE_URL}/api/health`, { tags: { endpoint: "health" } });
  check(health, { "health is 200": (r) => r.status === 200 });

  sleep(1 + Math.random() * 2); // think time, spreads request timing
}
