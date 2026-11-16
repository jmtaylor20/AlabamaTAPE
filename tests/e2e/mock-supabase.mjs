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

const user = {
  id: "00000000-0000-4000-8000-00000000e2e1",
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
  if (req.method === "GET" && path === "/auth/v1/user") return send(res, 200, user);
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
  if (req.method === "POST" && path.startsWith("/rest/v1/rpc/")) return send(res, 200, null);
  return send(res, 404, { message: `not mocked: ${req.method} ${path}` });
}).listen(port, "127.0.0.1", () => {
  console.log(`mock supabase listening on http://127.0.0.1:${port}`);
});
