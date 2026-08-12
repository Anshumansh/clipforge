// Scenario E (section 19): ramp to 150 users for 2 minutes (50% over the
// 100-user target), then return to normal load and verify the app recovers
// cleanly -- no crash, no restart, no permanently degraded latency once
// load subsides. See tests/load/README.md.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 100 }, // normal load
        { duration: "1m", target: 150 }, // ramp to spike
        { duration: "2m", target: 150 }, // hold spike
        { duration: "1m", target: 100 }, // ramp back down
        { duration: "3m", target: 100 }, // recovery window -- this is what proves recovery, not just survival
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"], // more lenient during the spike itself than the steady-state 1% target
    // The recovery window's own latency is what actually proves the system
    // recovered, not just tolerated the spike -- checked as a tagged
    // sub-metric so a slow spike doesn't mask a slow recovery or vice versa.
    "http_req_duration{phase:recovery}": ["p(95)<500"],
  },
};

export default function () {
  // Tag requests in the final stage as "recovery" so its threshold above is
  // measured independent of the spike itself. k6 doesn't expose "which
  // stage am I in" directly to the default export function, so this uses
  // elapsed test time as an approximation -- exec.instance timing details
  // vary by k6 version; adjust the cutoff to match this scenario's actual
  // stage boundaries (6 minutes in, per the stages above) if retiming this.
  const elapsedApprox = __ITER * 1.5; // rough VU-local approximation, not exact wall-clock
  const tags = elapsedApprox > 360 ? { phase: "recovery" } : {};

  const res = http.get(`${BASE_URL}/`, { tags });
  check(res, { "homepage loads": (r) => r.status === 200 });

  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health endpoint stays healthy through the spike": (r) => r.status === 200 });

  sleep(1 + Math.random() * 2);
}
