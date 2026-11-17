import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDateTime, statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Empty, LinkButton, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Message drafts" };

/** Every draft the caller may see. Nothing leaves the app until the State Admin approves. */
export default async function DraftsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const notices = await readNotices(searchParams);
  if (!user.isStaff) return <Alert tone="warning">This page is for ALSDE staff.</Alert>;
  const supabase = await createUserClient();
  const { data: drafts } = await supabase.from("email_drafts").select("id, step_key, audience, status, subject, to_list, cc_list, created_at, sent_at, lea_reviews(leas(name)), program_reviews(program_code, program_catalog(name))").order("created_at", { ascending: false }).limit(200);
  return (
    <>
      <PageHeader eyebrow="Communications" title="Message drafts" description="Generated from the review records at each step. The State Admin approves, then sends from here or copies to Outlook. Every message is kept." actions={user.isStateAdmin ? <LinkButton href="/app/admin/communications">Templates</LinkButton> : undefined} />
      <Notices {...notices} />
      {(drafts ?? []).length === 0 ? <Empty>No drafts yet. Draft buttons are on each LEA review, review workspace, and PIP page.</Empty> : (
        <Table caption="Message drafts" head={<tr><th className={th}>Created</th><th className={th}>Step</th><th className={th}>System</th><th className={th}>Subject</th><th className={th}>To</th><th className={th}>Status</th></tr>}>
          {(drafts ?? []).map((d) => {
            const lea = (d.lea_reviews as unknown as { leas: { name: string } | null } | null)?.leas?.name;
            const prog = d.program_reviews as unknown as { program_code: string; program_catalog: { name: string } | null } | null;
            return (
              <tr key={d.id}>
                <td className={td}>{fmtDateTime(d.created_at)}</td>
                <td className={td}>{statusLabel(d.step_key)} <Badge tone={d.audience === "district" ? "neutral" : "warn"}>{d.audience}</Badge></td>
                <td className={td}>{lea}{prog && <span className="block text-xs text-ink-muted">{prog.program_catalog?.name}</span>}</td>
                <td className={td}><Link href={`/app/drafts/${d.id}`} className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">{d.subject}</Link></td>
                <td className={td}>{(d.to_list as string[]).join(", ")}<span className="block text-xs text-ink-muted">{(d.cc_list as string[]).length} cc</span></td>
                <td className={td}><Badge tone={d.status === "sent" ? "good" : d.status === "approved" ? "warn" : d.status === "discarded" ? "bad" : "neutral"}>{statusLabel(d.status)}</Badge>{d.sent_at && <span className="block text-xs text-ink-muted">{fmtDateTime(d.sent_at)}</span>}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
