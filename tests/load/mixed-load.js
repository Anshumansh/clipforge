// Scenario D (section 19): mixed production-like traffic -- 100 users
// browsing public pages, 20 polling job status, while the worker is
// rendering continuously (start real jobs against the target before/during
// this run so there's something to poll and something keeping the worker
// busy -- this script does not itself submit jobs; pair it with a few
// generation-burst.js VUs, or trigger jobs out-of-band, per your run plan).
// Verifies the WEB response times don't materially degrade while rendering
// is actually happening -- the whole point of the worker/web isolation this
// branch builds on. See tests/load/README.md.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  scenarios: {
    browsing: {
      executor: "constant-vus",
      vus: 100,
      duration: "15m",
      exec: "browse",
    },
    polling: {
      executor: "constant-vus",
      vus: 20,
      duration: "15m",
      exec: "pollStatus",
    },
  },
  thresholds: {
    // Same public-page target as the pure-browsing scenario -- this is the
    // assertion that matters most here: web p95 must not degrade just
    // because the worker is under load.
    "http_req_duration{scenario:browsing}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

export function browse() {
  const res = http.get(`${BASE_URL}/`);
  check(res, { "homepage loads": (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}

export function pollStatus() {
  // Requires a real, in-flight project id to poll meaningfully -- set via
  // env when running this scenario for real. Falls back to the health
  // endpoint so the scenario still exercises *some* request shape without
  // one configured, rather than failing outright.
  const projectId = __ENV.POLL_PROJECT_ID;
  const res = projectId ? http.get(`${BASE_URL}/api/projects/${projectId}`) : http.get(`${BASE_URL}/api/health`);
  check(res, { "poll request succeeds": (r) => r.status === 200 || r.status === 401 });
  sleep(3 + Math.random()); // matches the app's own jittered client poll interval (components/project-status.tsx)
}
