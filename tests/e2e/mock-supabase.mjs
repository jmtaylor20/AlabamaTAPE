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

// Riverbend County, the fabricated system the live demonstration uses.
const HS = "00000000-0000-4000-8000-00000000c001";
const CTC = "00000000-0000-4000-8000-00000000c002";
const LR = "00000000-0000-4000-8000-00000000ba01";
const PR_WELD = "00000000-0000-4000-8000-00000000ab01";
const PR_HEALTH = "00000000-0000-4000-8000-00000000ab02";
const catalog = { "10": "Welding", "17": "Health Science", "11": "Construction Technology", "12": "Heating, Ventilation and Air Conditioning", "13": "Information Technology Support and Service", "05": "General Agriculture" };
const teacherOf = { "10": "Riley Blackwood", "17": "Parker Larkin", "11": "Casey Everly", "12": "Casey Calloway", "13": "Parker Blackwood" };
const schoolOf = { "10": CTC, "17": HS, "11": CTC, "12": CTC, "13": HS, "05": HS };
const schools = { [HS]: { id: HS, name: "Riverbend High School", school_code: "0010", school_type: "high_school", lea_id: LEA_ID, active: true }, [CTC]: { id: CTC, name: "Riverbend Career Technical Center", school_code: "6000", school_type: "career_tech_center", lea_id: LEA_ID, active: true } };
const declared = Object.keys(catalog).map((code, i) => ({
  id: `00000000-0000-4000-8000-0000000d${String(i).padStart(4, "0")}`, lea_id: LEA_ID, school_year_id: YEAR_ID, program_code: code, delivery_type: "LOCAL", dual_scenario: null, status: "active", vacant: code === "05", home_school_id: schoolOf[code],
  leas: { name: "Riverbend County", system_code: "901" }, program_catalog: { name: catalog[code], cluster_code: "04", active: true }, home: { name: schools[schoolOf[code]].name, school_code: schools[schoolOf[code]].school_code },
  declared_program_teachers: teacherOf[code] ? [{ teacher_id: `t-${code}`, teachers: { display_name: teacherOf[code] } }] : [],
}));
const milestones = [
  { kind: "check_in", computed_on: "2026-10-20", override_on: null }, { kind: "notification", computed_on: "2026-11-13", override_on: null }, { kind: "evidence_due", computed_on: "2026-12-01", override_on: null },
  { kind: "visit_start", computed_on: "2026-12-08", override_on: null }, { kind: "visit_end", computed_on: "2026-12-09", override_on: null }, { kind: "ten_day_close", computed_on: "2026-12-19", override_on: null },
];
const assignmentsFor = (lead, second) => [
  { id: `a-${lead}-1`, display_name: lead, email: `${lead.toLowerCase().replace(" ", ".")}@state.example.test`, assignment_role: "lead_reviewer", revoked_at: null },
  { id: `a-${second}-2`, display_name: second, email: `${second.toLowerCase().replace(" ", ".")}@state.example.test`, assignment_role: "reviewer", revoked_at: null },
];
const programReviews = [
  { id: PR_WELD, program_code: "10", status: "released", visit_date: null, sequence: 1, finalized_at: null, program_catalog: { name: "Welding" }, review_assignments: assignmentsFor("Quinn Kingsley", "Casey Larkin"), program_review_sites: [{ id: "s-weld", school_id: CTC, director_submitted_at: null }] },
  { id: PR_HEALTH, program_code: "17", status: "released", visit_date: null, sequence: 2, finalized_at: null, program_catalog: { name: "Health Science" }, review_assignments: assignmentsFor("Casey Larkin", "Quinn Kingsley"), program_review_sites: [{ id: "s-health", school_id: HS, director_submitted_at: null }] },
];
const leaReview = { id: LR, lea_id: LEA_ID, review_month: 12, review_year: 2026, status: "released", visit_start: "2026-12-08", visit_end: "2026-12-09", choice1_start: "2026-12-08", choice2_start: "2026-12-15", released_at: "2026-11-13T15:00:00Z", leas: { name: "Riverbend County", system_code: "901" }, review_cycles: { name: "2026-2027 TAPE reviews" }, milestones, program_reviews: programReviews };
const calendarUnsorted = [
  { id: "m1", lea_review_id: LR, lea_id: LEA_ID, lea_name: "Riverbend County", kind: "evidence_due", on_date: "2026-12-01", done: false, released: true },
  { id: "m2", lea_review_id: LR, lea_id: LEA_ID, lea_name: "Riverbend County", kind: "visit_start", on_date: "2026-12-08", done: false, released: true },
  { id: "m3", lea_review_id: LR, lea_id: LEA_ID, lea_name: "Riverbend County", kind: "visit_end", on_date: "2026-12-09", done: false, released: true },
  { id: "m4", lea_review_id: LR, lea_id: LEA_ID, lea_name: "Riverbend County", kind: "ten_day_close", on_date: "2026-12-19", done: false, released: true },
  { id: "m5", lea_review_id: "lr2", lea_id: "lea2", lea_name: "Pine Ridge City", kind: "notification", on_date: daysFromNow(4), done: false, released: false },
  { id: "m6", lea_review_id: "lr3", lea_id: "lea3", lea_name: "Cedar Hollow County", kind: "notification", on_date: daysFromNow(18), done: false, released: false },
];
const calendar = [...calendarUnsorted].sort((a, b) => a.on_date.localeCompare(b.on_date));

const common = {
  school_years: [{ id: YEAR_ID, label: "2026-2027", is_current: true }],
  review_cycles: [{ name: "2026-2027 TAPE reviews" }],
  leas: [{ id: LEA_ID, name: "Riverbend County", system_code: "901" }],
  schools: Object.values(schools),
  teachers: Object.entries(teacherOf).map(([code, name], i) => ({ id: `t-${code}`, display_name: name, email: `${name.toLowerCase().replace(" ", ".")}@riverbendcounty.example.test`, status: "active", alsde_teacher_id: `9${i}0${i}`, profile_id: null, teacher_years: [{ contract_type: "nine_month", first_year: false, school_years: { is_current: true } }] })),
  declared_programs: declared,
  calendar_items: calendar,
  declaration_windows: [],
  pips: [],
  email_drafts: [],
  desk_audits: [],
  evidence_files: [],
  form_141: [],
  review_assignments: [],
  approved_domains: [{ domain: "riverbendcounty.example.test" }],
  invitations: [],
  role_grants: [],
};

const adminRest = {
  ...common,
  profiles: [{ id: ADMIN_ID, display_name: "Avery Example", status: "active" }],
  role_grants: [{ id: "g1", role: "state_admin", lea_id: null, cluster_code: null, user_id: ADMIN_ID }],
  email_drafts: [
    { id: "d1", status: "draft", step_key: "notification", audience: "district", subject: "TAPE review notification: Riverbend County, December 2026", to_list: ["director@riverbendcounty.example.test"], cc_list: [], created_at: daysFromNow(-1) + "T14:00:00Z", sent_at: null, lea_reviews: { leas: { name: "Riverbend County" } }, program_reviews: null },
    { id: "d2", status: "approved", step_key: "check_in", audience: "district", subject: "TAPE review check-in: Pine Ridge City, January 2027", to_list: ["director@pineridgecity.example.test"], cc_list: [], created_at: daysFromNow(-3) + "T14:00:00Z", sent_at: null, lea_reviews: { leas: { name: "Pine Ridge City" } }, program_reviews: null },
  ],
  pips: [{ id: "p1", status: "open", starts_on: daysFromNow(-200), due_on: daysFromNow(-12), closed_at: null, pip_goals: [{ status: "not_complete" }, { status: "complete" }, { status: "not_complete" }], pip_escalations: [{ month: 6 }], program_reviews: { id: "pr-old", program_code: "11", program_catalog: { name: "Construction Technology" }, lea_reviews: { lea_id: "lea4", leas: { name: "Lakeview City" }, review_cycles: { school_year_id: YEAR_ID } }, program_review_sites: [{ school_id: null, schools: null }] } }],
  review_assignments: programReviews.map((p) => ({ id: `mine-${p.id}`, assignment_role: "reviewer", program_reviews: { ...p, lea_reviews: { id: LR, review_month: 12, review_year: 2026, visit_start: "2026-12-08", visit_end: "2026-12-09", released_at: leaReview.released_at, leas: { name: "Riverbend County" } } } })),
  lea_reviews: [
    leaReview,
    { id: "lr2", lea_id: "lea2", review_month: 1, review_year: 2027, status: "scheduled", visit_start: "2027-01-12", visit_end: "2027-01-13", choice1_start: "2027-01-12", choice2_start: null, released_at: null, leas: { name: "Pine Ridge City", system_code: "902" }, review_cycles: { name: "2026-2027 TAPE reviews" }, milestones: [{ kind: "notification", computed_on: daysFromNow(4), override_on: null }], program_reviews: [{ status: "selected" }, { status: "selected" }, { status: "selected" }] },
    { id: "lr3", lea_id: "lea3", review_month: 2, review_year: 2027, status: "listed", visit_start: null, visit_end: null, choice1_start: null, choice2_start: null, released_at: null, leas: { name: "Cedar Hollow County", system_code: "903" }, review_cycles: { name: "2026-2027 TAPE reviews" }, milestones: [{ kind: "notification", computed_on: daysFromNow(18), override_on: null }], program_reviews: [] },
  ],
};

const directorRest = {
  ...common,
  profiles: [{ id: DIRECTOR_ID, display_name: "Jordan Example", status: "active" }],
  role_grants: [{ id: "g2", role: "cte_director", lea_id: LEA_ID, cluster_code: null, user_id: DIRECTOR_ID, profiles: { display_name: "Jordan Example", email: "director@riverbendcounty.example.test", status: "active" } }],
  lea_reviews: [leaReview],
  calendar_items: calendar.filter((c) => c.lea_id === LEA_ID),
};

const rpcs = {
  review_counts: {
    [ADMIN_ID]: [
      { lea_id: LEA_ID, lea_name: "Riverbend County", program_code: "10", program_name: "Welding", cluster_code: "04", review_month: 12, review_year: 2026, status: "released", released: true, finalized: false, level2: 0, level1: 0, na: 0, open_findings: 0, cleared_findings: 0, pip_status: null, pip_due: null },
      { lea_id: LEA_ID, lea_name: "Riverbend County", program_code: "17", program_name: "Health Science", cluster_code: "08", review_month: 12, review_year: 2026, status: "released", released: true, finalized: false, level2: 0, level1: 0, na: 0, open_findings: 0, cleared_findings: 0, pip_status: null, pip_due: null },
      { lea_id: "lea2", lea_name: "Pine Ridge City", program_code: "01", program_name: "CTE Engineering", cluster_code: "01", review_month: 1, review_year: 2027, status: "selected", released: false, finalized: false, level2: 0, level1: 0, na: 0, open_findings: 0, cleared_findings: 0, pip_status: null, pip_due: null },
      { lea_id: "lea4", lea_name: "Lakeview City", program_code: "11", program_name: "Construction Technology", cluster_code: "04", review_month: 10, review_year: 2026, status: "post_visit", released: true, finalized: false, level2: 0, level1: 0, na: 0, open_findings: 0, cleared_findings: 0, pip_status: null, pip_due: null },
      { lea_id: "lea4", lea_name: "Lakeview City", program_code: "16", program_name: "Financial Management", cluster_code: "06", review_month: 10, review_year: 2026, status: "finalized", released: true, finalized: true, level2: 24, level1: 3, na: 2, open_findings: 3, cleared_findings: 1, pip_status: "open", pip_due: daysFromNow(-12) },
    ],
    [DIRECTOR_ID]: [],
  },
  finding_counts: { [ADMIN_ID]: [], [DIRECTOR_ID]: [] },
  my_lea_review_summary: { [ADMIN_ID]: [], [DIRECTOR_ID]: [{ lea_review_id: LR, review_month: 12, review_year: 2026, notification_on: "2026-11-13", released: true, status: "released" }] },
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
