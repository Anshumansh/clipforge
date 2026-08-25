// Scenario B (section 19): 100 authenticated users hitting project list,
// job list, account, and status-check endpoints. Requires
// TEST_USER_EMAIL/TEST_USER_PASSWORD for a seeded, owner-controlled test
// account -- never a real customer's credentials. See tests/load/README.md.
import http from "k6/http";
import { check, sleep, fail } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const EMAIL = __ENV.TEST_USER_EMAIL;
const PASSWORD = __ENV.TEST_USER_PASSWORD;

export const options = {
  scenarios: {
    dashboard: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 100 },
        { duration: "8m", target: 100 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    // Section 2's authenticated-API target.
    http_req_duration: ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

function login() {
  if (!EMAIL || !PASSWORD) {
    fail("TEST_USER_EMAIL and TEST_USER_PASSWORD must be set -- never hardcode credentials in this file");
  }
  // NextAuth's credentials flow needs a CSRF token first.
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`);
  const csrfToken = JSON.parse(csrfRes.body).csrfToken;

  const res = http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    { email: EMAIL, password: PASSWORD, csrfToken, json: "true" },
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  check(res, { "login succeeded": (r) => r.status === 200 || r.status === 302 });
  return res.cookies;
}

export default function authenticatedDashboardScenario() {
  // k6 VUs keep their own cookie jar automatically across requests in the
  // same iteration/session when using http.* with the default jar, so a
  // login once per VU (not per iteration) would be more realistic --
  // simplified here to log in every iteration for a self-contained script;
  // a real run should hoist this into setup() per VU if k6's execution
  // model for this test run supports it.
  login();

  const projects = http.get(`${BASE_URL}/dashboard`);
  check(projects, {
    "dashboard loads": (r) => r.status === 200,
    // Cross-tenant guard: this VU's own dashboard should never contain
    // another seeded test account's identifiable project titles. Left as a
    // placeholder assertion -- real tenant-isolation verification needs
    // fixture data specific to whatever accounts are actually seeded for a
    // given run, not something this generic script can assert blindly.
  });

  sleep(0.5);

  const billing = http.get(`${BASE_URL}/dashboard/billing`);
  check(billing, { "billing page loads": (r) => r.status === 200 });

  sleep(1 + Math.random() * 2);
}
