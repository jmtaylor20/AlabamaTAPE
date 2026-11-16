import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { approveDraft, discardDraft, markSentOutside, sendDraft, updateDraft } from "@/lib/actions/communications";
import { requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { OutlookHandoff } from "@/lib/components/outlook-handoff";
import { fmtDateTime, statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, Field, Input, LinkButton, PageHeader, Textarea } from "@/lib/ui";

export const metadata: Metadata = { title: "Draft" };

export default async function DraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireUser();
  const { id } = await params;
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: d } = await supabase.from("email_drafts").select("*, lea_reviews(id, released_at, leas(name)), program_reviews(program_code, program_catalog(name)), profiles!email_drafts_generated_by_fkey(display_name)").eq("id", id).maybeSingle();
  if (!d) notFound();
  const lea = (d.lea_reviews as unknown as { id: string; released_at: string | null; leas: { name: string } | null } | null);
  const to = d.to_list as string[];
  const cc = d.cc_list as string[];
  const editable = d.status === "draft" && (user.isStateAdmin || d.generated_by === user.id);
  const configured = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

  return (
    <>
      <PageHeader eyebrow={`${lea?.leas?.name ?? ""} / ${statusLabel(d.step_key)}`} title={d.subject} description={`Generated ${fmtDateTime(d.created_at)} by ${(d.profiles as unknown as { display_name: string } | null)?.display_name ?? "a staff member"}. ${d.audience === "district" ? "Goes to the district." : "Staff only; the guard refuses any district address."}`}
        actions={<><LinkButton href="/app/drafts">All drafts</LinkButton>{lea && <LinkButton href={`/app/admin/reviews/${lea.id}`}>LEA review</LinkButton>}<Badge tone={d.status === "sent" ? "good" : d.status === "approved" ? "warn" : d.status === "discarded" ? "bad" : "neutral"}>{statusLabel(d.status)}</Badge></>} />
      <Notices {...notices} />
      {d.send_error && <div className="mb-4"><Alert tone="danger" title="The last send attempt failed">{d.send_error}</Alert></div>}
      {d.status === "sent" && <div className="mb-4"><Alert tone="success">Sent {fmtDateTime(d.sent_at)}{d.provider_message_id === "sent-from-outlook" ? " from Outlook" : ""}.</Alert></div>}
      {d.audience === "district" && !lea?.released_at && <div className="mb-4"><Alert tone="warning">The notification for this system is not released. This message can carry only what the district may already know.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title="Message">
          <form action={updateDraft} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={d.id} />
            <fieldset disabled={!editable} className="contents">
              <Field id="to" label="To" hint="Separate addresses with commas."><Input id="to" name="to_list" defaultValue={to.join(", ")} /></Field>
              <Field id="cc" label="Cc"><Input id="cc" name="cc_list" defaultValue={cc.join(", ")} /></Field>
              <Field id="subject" label="Subject"><Input id="subject" name="subject" defaultValue={d.subject} /></Field>
              <Field id="body" label="Body"><Textarea id="body" name="body" defaultValue={d.body} className="min-h-96 font-mono text-sm" /></Field>
              {editable && <div><Button type="submit" variant="secondary">Save changes</Button></div>}
            </fieldset>
          </form>
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="Approve and send">
            {d.status === "draft" && (user.isStateAdmin ? (
              <form action={approveDraft} className="flex flex-col gap-2"><input type="hidden" name="id" value={d.id} /><p className="text-sm text-ink-muted">Approval records who signed off. Nothing is sent until the next step.</p><div><Button type="submit">Approve</Button></div></form>
            ) : <p className="text-sm text-ink-muted">The State Admin approves and sends. You can edit this draft until then.</p>)}
            {d.status === "approved" && user.isStateAdmin && (
              <div className="flex flex-col gap-3">
                <form action={sendDraft}><input type="hidden" name="id" value={d.id} /><Button type="submit" disabled={!configured}>{configured ? "Send from TAPE Online" : "Sending not configured"}</Button></form>
                {!configured && <p className="text-xs text-ink-muted">Set RESEND_API_KEY and EMAIL_FROM on the server to send from here. Until then, open it in Outlook.</p>}
                <form action={markSentOutside}><input type="hidden" name="id" value={d.id} /><Button type="submit" variant="secondary">I sent it from Outlook</Button></form>
              </div>
            )}
            {d.status !== "discarded" && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-sm font-semibold">Copy to Outlook</p>
                <OutlookHandoff draft={{ subject: d.subject, body: d.body, to, cc }} />
              </div>
            )}
            {d.status === "draft" && editable && (
              <form action={discardDraft} className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4"><input type="hidden" name="id" value={d.id} /><Input name="reason" placeholder="Reason (optional)" aria-label="Reason for discarding" className="min-h-9 max-w-56 text-xs" /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Discard</Button></form>
            )}
          </Card>
          <Card title="Merge fields used">
            <dl className="grid gap-1 text-xs">{Object.entries((d.merge ?? {}) as Record<string, string>).filter(([k]) => !["programs_table", "teachers_table", "pip_goals_list", "findings_list", "desk_audit_text"].includes(k)).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 font-mono text-ink-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}</dl>
          </Card>
        </div>
      </div>
    </>
  );
}
