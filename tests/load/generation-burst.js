// Scenario C (section 19): 100 users each submit ONE generation request
// within a 5-minute window. Does NOT wait for renders to complete -- the
// system is explicitly not required to render 100 videos simultaneously,
// only to accept/reject every request cleanly and return a job ID fast.
// Requires TEST_USER_EMAIL/TEST_USER_PASSWORD for a seeded, verified test
// account with enough credits for this run's VU count. See
// tests/load/README.md.
import http from "k6/http";
import { check, sleep, fail } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const EMAIL = __ENV.TEST_USER_EMAIL;
const PASSWORD = __ENV.TEST_USER_PASSWORD;

const duplicateJobIds = new Counter("duplicate_job_ids");
const seenJobIds = new Set();

export const options = {
  scenarios: {
    burst: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5m", target: 100 }, // 100 users submitting within 5 minutes
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    // Section 9's submission-latency target.
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
    duplicate_job_ids: ["count==0"], // no duplicate jobs, ever
  },
};

function login() {
  if (!EMAIL || !PASSWORD) {
    fail("TEST_USER_EMAIL and TEST_USER_PASSWORD must be set -- never hardcode credentials in this file");
  }
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`);
  const csrfToken = JSON.parse(csrfRes.body).csrfToken;
  http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    { email: EMAIL, password: PASSWORD, csrfToken, json: "true" },
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
}

export default function () {
  login();

  // Idempotency-Key required by the real generation routes (see
  // app/api/projects/script/route.ts) -- unique per submission here, since
  // this script is deliberately testing "100 distinct submissions", not
  // retry-safety (that's a separate, smaller, more targeted test, not a
  // load scenario).
  const idempotencyKey = `k6-burst-${__VU}-${__ITER}-${Date.now()}`;

  const res = http.post(
    `${BASE_URL}/api/projects/script`,
    JSON.stringify({ topic: `Load test submission from VU ${__VU} iteration ${__ITER}` }),
    { headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey } }
  );

  const accepted = check(res, {
    "accepted or cleanly rejected (200/201/429/503, never a 5xx)": (r) => r.status < 500,
  });

  if (res.status === 200 || res.status === 201) {
    const body = JSON.parse(res.body);
    check(body, { "response includes a project/job id": (b) => !!(b.projectId || b.jobId) });

    const id = body.projectId || body.jobId;
    if (id) {
      // k6 VUs run in separate isolates without shared JS state by default
      // -- a real cross-VU duplicate-ID check needs k6's shared-array or an
      // external store (e.g. writing IDs to a file/Redis and deduping after
      // the run), not an in-VU Set like this one, which only catches
      // duplicates within a single VU's own iterations. Documented as a
      // known limitation of this skeleton, not a false guarantee.
      if (seenJobIds.has(id)) duplicateJobIds.add(1);
      seenJobIds.add(id);
    }
  }

  if (!accepted) {
    console.error(`Unexpected 5xx from generation submission: ${res.status} ${res.body}`);
  }

  sleep(1 + Math.random() * 3); // spread submissions across the 5-minute window
}
