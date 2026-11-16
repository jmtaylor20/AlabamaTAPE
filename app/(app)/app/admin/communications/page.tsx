import type { Metadata } from "next";
import { saveTemplate } from "@/lib/actions/communications";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Field, Input, LinkButton, PageHeader, Textarea } from "@/lib/ui";

export const metadata: Metadata = { title: "Message templates" };

const FIELDS = ["lea_name", "system_code", "director_name", "review_month_year", "notification_date", "check_in_date", "visit_dates", "evidence_due", "ten_day_close", "programs_table", "teachers_table", "reviewers_list", "program_name", "findings_list", "desk_audit_text", "pip_start", "pip_due", "pip_goals_list", "pip_month", "escalation_month", "sender_name", "sender_email", "app_url"];

export default async function TemplatesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: templates } = await supabase.from("email_templates").select("*").order("created_at");
  return (
    <>
      <PageHeader eyebrow="Communications" title="Message templates" description="One template per step. Merge fields are written in double braces. District templates not allowed before release can only be drafted after the notification is released; staff-only templates refuse district addresses." actions={<LinkButton href="/app/drafts">Drafts</LinkButton>} />
      <Notices {...notices} />
      <Card title="Merge fields" className="mb-6"><p className="text-sm text-ink-muted">{FIELDS.map((f) => `{{${f}}}`).join("  ")}</p><p className="mt-2 text-xs text-ink-muted">Recipient roles: cte_director, lea_staff, teachers, lead_reviewer, reviewer, reviewers, cluster_admin, state_admin. Pairings are expanded automatically.</p></Card>
      <div className="flex flex-col gap-6">
        {(templates ?? []).map((t) => (
          <Card key={t.id} title={`${t.name}`} actions={<><Badge tone={t.audience === "district" ? "neutral" : "warn"}>{t.audience}</Badge>{t.allowed_before_release && <Badge tone="good">Allowed before release</Badge>}<Badge>v{t.version}</Badge>{!t.active && <Badge tone="bad">Inactive</Badge>}</>}>
            <form action={saveTemplate} className="grid gap-3 lg:grid-cols-2">
              <input type="hidden" name="id" value={t.id} />
              <Field id={`to-${t.id}`} label="To roles"><Input id={`to-${t.id}`} name="to_roles" defaultValue={(t.to_roles as string[]).join(", ")} /></Field>
              <Field id={`cc-${t.id}`} label="Cc roles"><Input id={`cc-${t.id}`} name="cc_roles" defaultValue={(t.cc_roles as string[]).join(", ")} /></Field>
              <div className="lg:col-span-2"><Field id={`s-${t.id}`} label="Subject"><Input id={`s-${t.id}`} name="subject" defaultValue={t.subject} /></Field></div>
              <div className="lg:col-span-2"><Field id={`b-${t.id}`} label="Body"><Textarea id={`b-${t.id}`} name="body" defaultValue={t.body} className="min-h-64 font-mono text-sm" /></Field></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={t.active} className="h-5 w-5" /> Active (step: {statusLabel(t.step_key)})</label>
              <div className="lg:text-right"><Button type="submit" variant="secondary">Save new version</Button></div>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
