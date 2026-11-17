/** Hand a draft to the user's own mail client. Pure, unit tested. */

export type Draft = { subject: string; body: string; to: string[]; cc: string[] };

export function mailtoHref(d: Draft) {
  const params = new URLSearchParams();
  if (d.cc.length) params.set("cc", d.cc.join(","));
  params.set("subject", d.subject);
  // Mail clients cap the URL; the body is also offered through the clipboard.
  params.set("body", d.body.length > 1800 ? `${d.body.slice(0, 1800)}\n\n[Message continues. Paste the full text from TAPE Online.]` : d.body);
  return `mailto:${encodeURIComponent(d.to.join(","))}?${params.toString().replaceAll("+", "%20")}`;
}

export function clipboardText(d: Draft) {
  return `To: ${d.to.join("; ")}\nCc: ${d.cc.join("; ")}\nSubject: ${d.subject}\n\n${d.body}`;
}
