import "server-only";

/**
 * Sends an approved draft through Resend. Nothing here decides who may send;
 * the caller has already passed the database checks. Without RESEND_API_KEY
 * the function reports that sending is not configured so the Outlook handoff
 * remains the path.
 */
export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(input: { to: string[]; cc: string[]; subject: string; text: string; replyTo?: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "Sending is not configured on this server (RESEND_API_KEY and EMAIL_FROM). Use Copy to Outlook." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: input.to, cc: input.cc.length ? input.cc : undefined, subject: input.subject, text: input.text, reply_to: input.replyTo }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { ok: false, error: json.message ?? `provider returned ${res.status}` };
    return json.id ? { ok: true, id: json.id } : { ok: false, error: "provider returned no message id" };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 200) };
  }
}
