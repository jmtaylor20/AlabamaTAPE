/**
 * Content security policy. Scripts run only when they carry this request's
 * nonce, or were loaded by a script that did (strict-dynamic). Next.js reads
 * the nonce from the request's own policy header and stamps it on every
 * inline and chunk script it emits. 'self' is a fallback for browsers that
 * predate strict-dynamic; modern browsers ignore it once a nonce is present.
 */
export function buildCsp(nonce: string, supabaseUrl: string | undefined) {
  let connect = "";
  try {
    const u = new URL(supabaseUrl ?? "");
    const ws = u.protocol === "http:" ? "ws:" : "wss:";
    connect = ` ${u.origin} ${ws}//${u.host}`;
  } catch {
    connect = "";
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${connect}`,
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self'`,
    "upgrade-insecure-requests",
  ].join("; ");
}
