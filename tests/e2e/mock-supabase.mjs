// A stand-in for the Supabase Auth API, used only by the end-to-end suite.
// It answers the handful of calls a sign-in and an authenticator enrollment
// make, with fabricated data, so a production build of the app can be driven
// through the MFA page without a real identity provider. Nothing here is a
// real person, key, or secret.
import { createServer } from "node:http";

const port = Number(process.env.E2E_MOCK_SUPABASE_PORT ?? 3101);
const calls = [];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "access-control-max-age": "600",
};

// Two fabricated people: a State Admin and a CTE Director. The JWT's subject
// picks which one a REST call sees, so the suite can render each role's pages.
export const ADMIN_ID = "00000000-0000-4000-8000-00000000e2e1";
export const DIRECTOR_ID = "00000000-0000-4000-8000-00000000e2e2";
const LEA_ID = "00000000-0000-4000-8000-0000000001ea";
const YEAR_ID = "00000000-0000-4000-8000-00000000ea71";

function daysFromNow(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function subjectOf(req) {
  const auth = req.headers.authorization ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).sub ?? null;
  } catch {
    return null;
  }
}

const common = {
  school_years: [{ id: YEAR_ID, label: "2026-2027", is_current: true }],
  review_cycles: [{ name: "2026-2027 TAPE cycle" }],
  leas: [{ id: LEA_ID, name: "Example City Schools", system_code: "999" }],
  declaration_windows: [],
  pips: [],
  email_drafts: [],
  desk_audits: [],
  evidence_files: [],
  declared_programs: [],
  review_assignments: [],
};

const adminRest = {
  ...common,
  profiles: [{ id: ADMIN_ID, display_name: "Avery Example", status: "active" }],
  role_grants: [{ id: "g1", role: "state_admin", lea_id: null, cluster_code: null, user_id: ADMIN_ID }],
  email_drafts: [{ id: "d1", status: "draft" }, { id: "d2", status: "approved" }],
  pips: [{ id: "p1", status: "open", due_on: daysFromNow(-12), program_reviews: { program_code: "520101", lea_reviews: { leas: { name: "Sample County Schools" } } } }],
  calendar_items: [
    { id: "m1", lea_review_id: "lr1", lea_id: LEA_ID, lea_name: "Example City Schools", kind: "notification", on_date: daysFromNow(4), done: false, released: false },
    { id: "m2", lea_review_id: "lr2", lea_id: "lea2", lea_name: "Sample County Schools", kind: "evidence_due", on_date: daysFromNow(9), done: false, released: true },
    { id: "m3", lea_review_id: "lr2", lea_id: "lea2", lea_name: "Sample County Schools", kind: "visit_start", on_date: daysFromNow(21), done: false, released: true },
  ],
  lea_reviews: [],
};

const directorRest = {
  ...common,
  profiles: [{ id: DIRECTOR_ID, display_name: "Jordan Example", status: "active" }],
  role_grants: [{ id: "g2", role: "cte_director", lea_id: LEA_ID, cluster_code: null, user_id: DIRECTOR_ID }],
  lea_reviews: [{
    id: "lr1", visit_start: daysFromNow(30), visit_end: daysFromNow(31), status: "evidence_due", review_month: 2, review_year: 2027,
    milestones: [{ kind: "evidence_due", computed_on: daysFromNow(14), override_on: null }],
    program_reviews: [
      { id: "pr1", program_code: "520101", status: "released", program_catalog: { name: "Business Management" }, program_review_sites: [{ director_submitted_at: null }] },
      { id: "pr2", program_code: "510101", status: "evidence_submitted", program_catalog: { name: "Health Science" }, program_review_sites: [{ director_submitted_at: "2026-11-01T00:00:00Z" }] },
    ],
  }],
};

const rpcs = {
  review_counts: {
    [ADMIN_ID]: [
      { lea_id: LEA_ID, lea_name: "Example City Schools", program_code: "520101", program_name: "Business Management", cluster_code: "BMA", review_month: 2, review_year: 2027, status: "selected", released: false, finalized: false, level2: 0, level1: 0, na: 0, open_findings: 0, cleared_findings: 0, pip_status: null, pip_due: null },
      { lea_id: "lea2", lea_name: "Sample County Schools", program_code: "510101", program_name: "Health Science", cluster_code: "HS", review_month: 1, review_year: 2027, status: "post_visit", released: true, finalized: false, level2: 0, level1: 0, na: 0, open_findings: 0, cleared_findings: 0, pip_status: null, pip_due: null },
      { lea_id: "lea2", lea_name: "Sample County Schools", program_code: "520201", program_name: "Finance", cluster_code: "BMA", review_month: 1, review_year: 2027, status: "finalized", released: true, finalized: true, level2: 24, level1: 3, na: 2, open_findings: 3, cleared_findings: 1, pip_status: "open", pip_due: daysFromNow(-12) },
    ],
    [DIRECTOR_ID]: [],
  },
  finding_counts: { [ADMIN_ID]: [], [DIRECTOR_ID]: [] },
  my_lea_review_summary: { [ADMIN_ID]: [], [DIRECTOR_ID]: [{ lea_review_id: "lr1", review_month: 2, review_year: 2027, notification_on: daysFromNow(-10), released: true, status: "evidence_due" }] },
  log_event: { [ADMIN_ID]: null, [DIRECTOR_ID]: null },
};

const user = {
  id: ADMIN_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "reviewer.one@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  phone: "",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  factors: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// A one-square SVG. supabase-js turns it into a data: image for the page.
const QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><rect x="2" y="2" width="4" height="4" fill="black"/></svg>';

function send(res, status, body) {
  res.writeHead(status, { ...CORS, "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (path === "/__calls") {
    if (req.method === "DELETE") calls.length = 0;
    return send(res, 200, calls);
  }
  calls.push(`${req.method} ${path}`);
  if (req.method === "GET" && path === "/auth/v1/user") {
    const sub = subjectOf(req);
    return send(res, 200, sub === DIRECTOR_ID ? { ...user, id: DIRECTOR_ID, email: "director.example@example.test" } : user);
  }
  if (req.method === "POST" && path === "/auth/v1/factors") {
    return send(res, 200, {
      id: "00000000-0000-4000-8000-0000000fac70",
      type: "totp",
      friendly_name: "Authenticator app",
      totp: { qr_code: QR, secret: "FABRICATEDSECRET234567", uri: "otpauth://totp/TAPE%20Online:reviewer.one%40example.test?secret=FABRICATEDSECRET234567" },
    });
  }
  if (req.method === "DELETE" && path.startsWith("/auth/v1/factors/")) return send(res, 200, {});
  if (req.method === "POST" && path === "/auth/v1/verify") return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" });
  if (req.method === "POST" && path === "/auth/v1/logout") return send(res, 204);
  if (path.startsWith("/rest/v1/")) {
    const sub = subjectOf(req);
    const data = sub === DIRECTOR_ID ? directorRest : adminRest;
    const name = path.slice("/rest/v1/".length);
    if (req.method === "POST" && name.startsWith("rpc/")) {
      const fn = name.slice(4);
      return send(res, 200, fn in rpcs ? (rpcs[fn][sub] ?? []) : []);
    }
    if (req.method === "GET") return send(res, 200, data[name] ?? []);
    return send(res, 200, []);
  }
  return send(res, 404, { message: `not mocked: ${req.method} ${path}` });
}).listen(port, "127.0.0.1", () => {
  console.log(`mock supabase listening on http://127.0.0.1:${port}`);
});
