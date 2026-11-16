-- 0010: communications. Templates with recipient rules, drafts generated in
-- the database from the review records, two guards enforced by trigger:
--   1. a staff-audience template never carries a district address;
--   2. before release, a district-audience draft is refused unless its
--      template is allowed before release, and even then its text may not
--      contain a selected program name, a reviewer's name or address, or
--      the visit dates.
-- Sending is a separate step done by the State Admin after approval.

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  step_key text not null unique,
  name text not null,
  audience text not null check (audience in ('district', 'staff')),
  subject text not null,
  body text not null,
  to_roles jsonb not null default '[]'::jsonb,
  cc_roles jsonb not null default '[]'::jsonb,
  allowed_before_release boolean not null default false,
  expand_pairings boolean not null default true,
  scope text not null default 'lea_review' check (scope in ('lea_review', 'program_review', 'pip')),
  active boolean not null default true,
  version integer not null default 1,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.email_templates (id),
  step_key text not null,
  audience text not null check (audience in ('district', 'staff')),
  lea_review_id uuid not null references public.lea_reviews (id),
  program_review_id uuid references public.program_reviews (id),
  pip_id uuid references public.pips (id),
  subject text not null,
  body text not null,
  to_list jsonb not null default '[]'::jsonb,
  cc_list jsonb not null default '[]'::jsonb,
  merge jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'discarded')),
  generated_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  sent_by uuid references public.profiles (id),
  sent_at timestamptz,
  provider_message_id text,
  send_error text,
  discard_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_drafts_review on public.email_drafts (lea_review_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Address classification and recipient resolution
-- ---------------------------------------------------------------------------
create or replace function app.is_district_address(p_email text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_email is not null and (
    exists (select 1 from public.approved_domains d where d.lea_id is not null and lower(split_part(p_email, '@', 2)) = d.domain)
    or exists (select 1 from public.lea_contacts c where c.email = lower(p_email))
    or exists (select 1 from public.teachers t where t.email = lower(p_email))
    or exists (select 1 from public.profiles p join public.role_grants g on g.user_id = p.id where p.email = lower(p_email) and g.lea_id is not null and g.revoked_at is null)
  );
$$;

-- Emails for one recipient role in the scope of an LEA review (and optionally one program review).
create or replace function app.resolve_recipients(p_role text, p_lea_review uuid, p_program_review uuid) returns setof text
language sql stable security definer set search_path = ''
as $$
  with lr as (select r.id, r.lea_id from public.lea_reviews r where r.id = p_lea_review),
  prs as (select p.id from public.program_reviews p, lr where p.lea_review_id = lr.id and p.status <> 'removed' and (p_program_review is null or p.id = p_program_review))
  select distinct lower(e) from (
    select c.email as e from public.lea_contacts c, lr where p_role = 'cte_director' and c.lea_id = lr.lea_id and c.contact_role = 'cte_director' and c.active and c.email is not null
    union all
    select pr.email from public.profiles pr join public.role_grants g on g.user_id = pr.id, lr where p_role in ('cte_director', 'lea_staff') and g.lea_id = lr.lea_id and g.role::text = p_role and g.revoked_at is null and pr.status = 'active'
    union all
    select t.email from public.program_review_sites s join public.program_review_site_teachers st on st.site_id = s.id join public.teachers t on t.id = st.teacher_id, prs
      where p_role = 'teachers' and s.program_review_id = prs.id and t.email is not null and t.status = 'active'
    union all
    select a.email from public.review_assignments a, prs where p_role in ('lead_reviewer', 'reviewer', 'cluster_admin') and a.program_review_id = prs.id and a.assignment_role = p_role and a.revoked_at is null
    union all
    select a.email from public.review_assignments a, prs where p_role = 'reviewers' and a.program_review_id = prs.id and a.assignment_role in ('lead_reviewer', 'reviewer') and a.revoked_at is null
    union all
    select pr.email from public.profiles pr join public.role_grants g on g.user_id = pr.id where p_role = 'state_admin' and g.role = 'state_admin' and g.revoked_at is null and pr.status = 'active'
  ) x where e is not null;
$$;

-- Wherever person A is included, person B is included too (for the dates of the pairing).
create or replace function app.expand_pairings(p_emails jsonb) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from (
    select lower(value) as e from jsonb_array_elements_text(p_emails)
    union
    select lower(b.email) from jsonb_array_elements_text(p_emails) x
      join public.profiles a on a.email = lower(x.value)
      join public.staff_pairings sp on sp.person_a = a.id and sp.starts_on <= current_date and (sp.ends_on is null or sp.ends_on >= current_date)
      join public.profiles b on b.id = sp.person_b and b.status = 'active'
  ) y;
$$;

grant execute on function app.is_district_address(text), app.resolve_recipients(text, uuid, uuid), app.expand_pairings(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------------
create or replace function app.guard_email_draft() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare addr text; released boolean; allowed boolean; name text; low text;
begin
  select r.released_at is not null into released from public.lea_reviews r where r.id = new.lea_review_id;
  select coalesce(t.allowed_before_release, false) into allowed from public.email_templates t where t.id = new.template_id;
  if new.audience = 'staff' then
    for addr in select value from jsonb_array_elements_text(new.to_list || new.cc_list) loop
      if app.is_district_address(addr) then raise exception 'a staff-only message cannot include a district address (%)', addr using errcode = '42501'; end if;
    end loop;
  end if;
  if new.audience = 'district' and not coalesce(released, false) then
    if not allowed then raise exception 'this message cannot be drafted to the district before the notification is released' using errcode = '42501'; end if;
    low := lower(new.subject || E'\n' || new.body);
    for name in
      select lower(c.name) from public.program_reviews p join public.program_catalog c on c.code = p.program_code where p.lea_review_id = new.lea_review_id and p.status <> 'removed'
      union select lower(a.email) from public.review_assignments a join public.program_reviews p on p.id = a.program_review_id where p.lea_review_id = new.lea_review_id and a.revoked_at is null
      union select lower(a.display_name) from public.review_assignments a join public.program_reviews p on p.id = a.program_review_id where p.lea_review_id = new.lea_review_id and a.revoked_at is null and a.display_name is not null
      union select to_char(r.visit_start, 'FMMonth FMDD, YYYY') from public.lea_reviews r where r.id = new.lea_review_id and r.visit_start is not null
    loop
      if name is not null and length(name) > 2 and position(lower(name) in low) > 0 then
        raise exception 'embargoed content (%) cannot be sent to the district before release', name using errcode = '42501';
      end if;
    end loop;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger email_drafts_guard before insert or update on public.email_drafts for each row execute function app.guard_email_draft();

-- ---------------------------------------------------------------------------
-- Draft generation
-- ---------------------------------------------------------------------------
create or replace function app.generate_draft(p_step text, p_lea_review uuid, p_program_review uuid default null, p_pip uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare t public.email_templates%rowtype; r public.lea_reviews%rowtype; l public.leas%rowtype; pr public.program_reviews%rowtype; pip public.pips%rowtype;
  m jsonb := '{}'::jsonb; k text; v text; subj text; body text; tos jsonb := '[]'::jsonb; ccs jsonb := '[]'::jsonb; role text; released boolean; v_id uuid; sender record;
begin
  select * into t from public.email_templates where step_key = p_step and active;
  if t.id is null then raise exception 'no active template for step %', p_step; end if;
  select * into r from public.lea_reviews where id = p_lea_review;
  if r.id is null then raise exception 'review not found'; end if;
  if not app.authed() or not (app.is_state_admin() or app.assigned_in_lea_review(p_lea_review)) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into l from public.leas where id = r.lea_id;
  if p_program_review is not null then select * into pr from public.program_reviews where id = p_program_review; end if;
  if p_pip is not null then select * into pip from public.pips where id = p_pip; if pr.id is null then select * into pr from public.program_reviews where id = pip.program_review_id; end if; end if;
  released := r.released_at is not null;
  select p.display_name, p.email into sender from public.profiles p where p.id = auth.uid();

  m := m || jsonb_build_object(
    'lea_name', l.name, 'system_code', l.system_code,
    'director_name', coalesce((select c.display_name from public.lea_contacts c where c.lea_id = l.id and c.contact_role = 'cte_director' and c.active order by c.created_at limit 1), 'CTE Director'),
    'review_month_year', to_char(make_date(r.review_year, r.review_month, 1), 'FMMonth YYYY'),
    'notification_date', coalesce(to_char(app.milestone_date(r.id, 'notification'), 'FMMonth FMDD, YYYY'), 'the notification date'),
    'check_in_date', coalesce(to_char(app.milestone_date(r.id, 'check_in'), 'FMMonth FMDD, YYYY'), ''),
    'sender_name', coalesce(sender.display_name, ''), 'sender_email', coalesce(sender.email, ''),
    'app_url', 'https://alabamatape.netlify.app'
  );
  -- Fields that exist only after release (or for staff).
  if released or t.audience = 'staff' then
    m := m || jsonb_build_object(
      'visit_dates', case when r.visit_start is null then 'to be scheduled' when r.visit_end is null or r.visit_end = r.visit_start then to_char(r.visit_start, 'FMDay, FMMonth FMDD, YYYY') else to_char(r.visit_start, 'FMMonth FMDD') || ' to ' || to_char(r.visit_end, 'FMMonth FMDD, YYYY') end,
      'evidence_due', coalesce(to_char(app.milestone_date(r.id, 'evidence_due'), 'FMMonth FMDD, YYYY'), ''),
      'ten_day_close', coalesce(to_char(app.milestone_date(r.id, 'ten_day_close'), 'FMMonth FMDD, YYYY'), ''),
      'programs_table', coalesce((select string_agg(c.name || ': ' || coalesce((select string_agg(coalesce(a.display_name, a.email) || ' (' || a.email || ')', ', ' order by a.sort) from public.review_assignments a where a.program_review_id = p.id and a.revoked_at is null and a.assignment_role in ('lead_reviewer', 'reviewer')), 'reviewer to be assigned'), E'\n' order by c.name)
        from public.program_reviews p join public.program_catalog c on c.code = p.program_code where p.lea_review_id = r.id and p.status <> 'removed' and (p_program_review is null or p.id = p_program_review)), ''),
      'teachers_table', coalesce((select string_agg(c.name || ' at ' || coalesce(s.school_name, 'the system') || ': ' || coalesce((select string_agg(tt.display_name || coalesce(' (' || tt.email || ')', ''), ', ' order by tt.display_name) from public.program_review_site_teachers st join public.teachers tt on tt.id = st.teacher_id where st.site_id = s.id), 'teacher to be confirmed'), E'\n' order by c.name, s.school_name)
        from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id join public.program_catalog c on c.code = p.program_code where p.lea_review_id = r.id and p.status <> 'removed' and (p_program_review is null or p.id = p_program_review)), ''),
      'reviewers_list', coalesce((select string_agg(distinct coalesce(a.display_name, a.email), ', ') from public.review_assignments a join public.program_reviews p on p.id = a.program_review_id where p.lea_review_id = r.id and a.revoked_at is null and a.assignment_role in ('lead_reviewer', 'reviewer') and (p_program_review is null or p.id = p_program_review)), '')
    );
  end if;
  if pr.id is not null then
    m := m || jsonb_build_object(
      'program_name', (select c.name from public.program_catalog c where c.code = pr.program_code),
      'findings_list', coalesce((select string_agg(f.qpi_code || ': ' || f.body, E'\n' order by f.qpi_code) from public.findings f join public.program_review_sites s on s.id = f.site_id where s.program_review_id = pr.id and f.status = 'open'), 'No findings.'),
      'desk_audit_text', coalesce((select d.initial_findings from public.desk_audits d join public.program_review_sites s on s.id = d.site_id where s.program_review_id = pr.id limit 1), '')
    );
  end if;
  if pip.id is not null then
    m := m || jsonb_build_object(
      'pip_due', to_char(pip.due_on, 'FMMonth FMDD, YYYY'), 'pip_start', to_char(pip.starts_on, 'FMMonth FMDD, YYYY'),
      'pip_goals_list', coalesce((select string_agg(g.qpi_code || ': ' || coalesce(nullif(g.action_steps, ''), '(action steps to be written)') || case when g.status is null then '' else ' [' || replace(g.status, '_', ' ') || ']' end, E'\n' order by g.sort) from public.pip_goals g where g.pip_id = pip.id), ''),
      'pip_month', (select greatest(1, least(12, ((current_date - pip.starts_on) / 30) + 1)))::text,
      'escalation_month', coalesce((select max(e.month) from public.pip_escalations e where e.pip_id = pip.id), 0)::text
    );
  end if;

  subj := t.subject; body := t.body;
  for k, v in select key, value from jsonb_each_text(m) loop
    subj := replace(subj, '{{' || k || '}}', coalesce(v, ''));
    body := replace(body, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  -- Anything left unmerged (an embargoed field before release) is blanked, never leaked.
  subj := regexp_replace(subj, '\{\{[a-z_]+\}\}', '', 'g');
  body := regexp_replace(body, '\{\{[a-z_]+\}\}', '', 'g');

  for role in select value from jsonb_array_elements_text(t.to_roles) loop
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v from app.resolve_recipients(role, r.id, p_program_review) e; tos := tos || v::jsonb;
  end loop;
  for role in select value from jsonb_array_elements_text(t.cc_roles) loop
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v from app.resolve_recipients(role, r.id, p_program_review) e; ccs := ccs || v::jsonb;
  end loop;
  if t.expand_pairings then tos := app.expand_pairings(tos); ccs := app.expand_pairings(ccs); end if;
  select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into tos from jsonb_array_elements_text(tos) x;
  select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into ccs from jsonb_array_elements_text(ccs) x where not (tos ? x);

  insert into public.email_drafts (template_id, step_key, audience, lea_review_id, program_review_id, pip_id, subject, body, to_list, cc_list, merge, generated_by)
  values (t.id, t.step_key, t.audience, r.id, pr.id, pip.id, subj, body, tos, ccs, m, auth.uid()) returning id into v_id;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'email.drafted', 'email_drafts', v_id::text, r.lea_id, jsonb_build_object('step', p_step, 'to', tos, 'cc', ccs));
  return v_id;
end;
$$;

create or replace function app.approve_draft(p_draft uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.authed() or not app.is_state_admin() then raise exception 'only the State Admin approves messages' using errcode = '42501'; end if;
  update public.email_drafts set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_draft and status = 'draft';
  if not found then raise exception 'only a draft can be approved'; end if;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id) values (auth.uid(), auth.role(), 'email.approved', 'email_drafts', p_draft::text);
end;
$$;

create or replace function app.mark_draft_sent(p_draft uuid, p_message_id text, p_error text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.authed() or not app.is_state_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_error is null then
    update public.email_drafts set status = 'sent', sent_by = auth.uid(), sent_at = now(), provider_message_id = p_message_id, send_error = null where id = p_draft and status = 'approved';
    if not found then raise exception 'only an approved message can be marked sent'; end if;
    insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, meta) values (auth.uid(), auth.role(), 'email.sent', 'email_drafts', p_draft::text, jsonb_build_object('message_id', p_message_id));
  else
    update public.email_drafts set send_error = p_error where id = p_draft;
    insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, meta) values (auth.uid(), auth.role(), 'email.send_failed', 'email_drafts', p_draft::text, jsonb_build_object('error', p_error));
  end if;
end;
$$;

grant execute on function app.generate_draft(text, uuid, uuid, uuid), app.approve_draft(uuid), app.mark_draft_sent(uuid, text, text) to authenticated;
create or replace function public.generate_draft(p_step text, p_lea_review uuid, p_program_review uuid default null, p_pip uuid default null) returns uuid language sql security invoker set search_path = '' as $$ select app.generate_draft(p_step, p_lea_review, p_program_review, p_pip); $$;
create or replace function public.approve_draft(p_draft uuid) returns void language sql security invoker set search_path = '' as $$ select app.approve_draft(p_draft); $$;
create or replace function public.mark_draft_sent(p_draft uuid, p_message_id text default null, p_error text default null) returns void language sql security invoker set search_path = '' as $$ select app.mark_draft_sent(p_draft, p_message_id, p_error); $$;
grant execute on function public.generate_draft(text, uuid, uuid, uuid), public.approve_draft(uuid), public.mark_draft_sent(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Calendar: every milestone the caller may see, as rows
-- ---------------------------------------------------------------------------
create or replace view public.calendar_items with (security_invoker = true) as
  select m.id, m.lea_review_id, r.lea_id, l.name as lea_name, m.kind, coalesce(m.override_on, m.computed_on) as on_date, m.completed_at is not null as done, r.released_at is not null as released, r.review_month, r.review_year
  from public.milestones m join public.lea_reviews r on r.id = m.lea_review_id join public.leas l on l.id = r.lea_id
  where coalesce(m.override_on, m.computed_on) is not null;
grant select on public.calendar_items to authenticated;

-- ---------------------------------------------------------------------------
-- Audit, policies
-- ---------------------------------------------------------------------------
create trigger audit_email_templates after insert or update or delete on public.email_templates for each row execute function app.audit_row_change();
create trigger audit_email_drafts after insert or update or delete on public.email_drafts for each row execute function app.audit_row_change();

alter table public.email_templates enable row level security;
alter table public.email_drafts enable row level security;
grant select, insert, update on public.email_templates, public.email_drafts to authenticated;

create policy email_templates_read on public.email_templates for select to authenticated using (app.authed() and app.is_staff());
create policy email_templates_write on public.email_templates for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy email_drafts_read on public.email_drafts for select to authenticated using (
  app.authed() and (
    app.is_state_admin() or app.assigned_in_lea_review(lea_review_id)
    or (app.has_role('cluster_admin') and exists (select 1 from public.program_reviews p where p.lea_review_id = email_drafts.lea_review_id and app.cluster_admin_for_program(p.program_code)))
  )
);
-- Edits before approval: the State Admin, or the assigned reviewer who generated it.
create policy email_drafts_update on public.email_drafts for update to authenticated
  using (app.authed() and status = 'draft' and (app.is_state_admin() or (generated_by = auth.uid() and app.assigned_in_lea_review(lea_review_id))))
  with check (app.authed() and status in ('draft', 'discarded') and (app.is_state_admin() or (generated_by = auth.uid() and app.assigned_in_lea_review(lea_review_id))));

-- ---------------------------------------------------------------------------
-- Default templates. Merge fields are written {{like_this}}. No names here.
-- Kept in a function so it can be re-run (and so the test suites can seed it).
-- ---------------------------------------------------------------------------
create or replace function app.seed_default_templates() returns void
language plpgsql security definer set search_path = ''
as $seed$
begin
insert into public.email_templates (step_key, name, audience, scope, subject, to_roles, cc_roles, allowed_before_release, body) values
('check_in', 'Check-in before notification', 'district', 'lea_review', 'TAPE review check-in: {{lea_name}}, {{review_month_year}}', '["cte_director"]', '["state_admin"]', true,
E'Good morning {{director_name}},\n\n{{lea_name}} is on the compliance list for a TAPE review in {{review_month_year}}. Official notification, including the programs selected, the reviewers, and the visit dates, will be released on {{notification_date}}.\n\nBefore then, please sign in to TAPE Online and confirm your system''s declared programs and teacher information: {{app_url}}\n\nPlease reply to confirm receipt and let me know of any changes to your CTE staff.\n\nThank you,\n{{sender_name}}\nAlabama State Department of Education\nCareer and Technical Education | Workforce Development\n{{sender_email}}'),
('declaration_window', 'Declaration review window opened', 'district', 'lea_review', 'Action needed: confirm your declared CTE programs, {{lea_name}}', '["cte_director"]', '["state_admin"]', true,
E'Good morning {{director_name}},\n\nYour declared CTE programs for this school year are ready for your review in TAPE Online. You have one window to confirm or correct the list: {{app_url}}\n\nCheck every program, school, and teacher. Add anything missing, mark anything not offered, then confirm. After the window closes, changes go through ALSDE.\n\nThank you,\n{{sender_name}}\n{{sender_email}}'),
('notification', 'Official review notification', 'district', 'lea_review', 'TAPE Review Notification: {{lea_name}}, {{visit_dates}}', '["cte_director"]', '["reviewers", "cluster_admin", "teachers", "state_admin"]', false,
E'Good morning {{director_name}},\n\nPlease consider this email official notification that {{lea_name}}''s TAPE Review visit is scheduled for {{visit_dates}}.\n\nProgram(s) to be reviewed, with the ALSDE reviewer for each:\n{{programs_table}}\n\nTeacher information:\n{{teachers_table}}\n\nKey dates\n{{notification_date}}: notification released. Evidence upload and Director self-scoring are open in TAPE Online: {{app_url}}\n{{evidence_due}}: all requested evidence uploaded and QPIs 2.1 A to D self-scored by the system.\n{{visit_dates}}: onsite review. Expect approximately two hours per program at each location. ALSDE staff will coordinate the specific schools, days, and times with you.\n\nAction items. Please reply to this email with:\n1. Confirmation of receipt of this notification.\n2. Confirmation that the teacher information above is correct, or any changes. We encourage communication between the teachers and the ALSDE program area specialist throughout the review.\n\nPlease complete the following:\n1. No later than {{evidence_due}}, upload the requested evidence in TAPE Online and score QPIs 2.1 A to D.\n2. Arrange substitute or classroom coverage for the teachers being reviewed during the time the ALSDE reviewer is onsite.\n\nALSDE contact for the TAPE process: {{sender_name}}, {{sender_email}}\n\nIf you have any questions, please let me know.\n\nThanks,\n{{sender_name}}\nAlabama State Department of Education\nCareer and Technical Education | Workforce Development\nTAPE | Tool for Assessing Program Effectiveness'),
('evidence_reminder', 'Evidence due reminder', 'district', 'lea_review', 'Reminder: TAPE evidence due {{evidence_due}}, {{lea_name}}', '["cte_director"]', '["teachers", "reviewers", "state_admin"]', false,
E'Good morning {{director_name}},\n\nA reminder that evidence for the programs under review is due in TAPE Online by {{evidence_due}}, along with your self-scores on QPIs 2.1 A to D for each program: {{app_url}}\n\nPrograms under review:\n{{programs_table}}\n\nThank you,\n{{sender_name}}\n{{sender_email}}'),
('desk_audit', 'Desk audit findings', 'district', 'program_review', 'TAPE desk audit: {{program_name}}, {{lea_name}}', '["cte_director"]', '["teachers", "reviewers", "state_admin"]', false,
E'Good morning {{director_name}},\n\nAhead of the onsite visit on {{visit_dates}}, here are the initial findings from the desk audit of the {{program_name}} evidence:\n\n{{desk_audit_text}}\n\nAnything added to TAPE Online before the visit will be considered. Please share this with the program teacher(s).\n\nThank you,\n{{sender_name}}\n{{sender_email}}'),
('conclusion', 'Review conclusion', 'district', 'program_review', 'TAPE review concluded: {{program_name}}, {{lea_name}}', '["cte_director"]', '["teachers", "reviewers", "cluster_admin", "state_admin"]', false,
E'Good morning {{director_name}},\n\nThe TAPE review of {{program_name}} is complete. Thank you and the program teacher(s) for your work and your hospitality during the visit.\n\nFindings:\n{{findings_list}}\n\nThe full report and, where findings remain, the Program Improvement Plan are in TAPE Online: {{app_url}}\n\nThank you,\n{{sender_name}}\n{{sender_email}}'),
('pip_followup', 'PIP monthly follow-up', 'district', 'pip', 'PIP follow-up, month {{pip_month}}: {{program_name}}, {{lea_name}}', '["cte_director"]', '["teachers", "reviewers", "state_admin"]', false,
E'Good morning {{director_name}},\n\nThis is the month {{pip_month}} check on the Program Improvement Plan for {{program_name}}. The plan is due {{pip_due}}.\n\nGoals:\n{{pip_goals_list}}\n\nPlease add notes or evidence for each goal in TAPE Online: {{app_url}}\n\nThank you,\n{{sender_name}}\n{{sender_email}}'),
('pip_escalation', 'PIP escalation to the cluster administrator', 'staff', 'pip', 'PIP escalation, month {{escalation_month}}: {{program_name}}, {{lea_name}}', '["cluster_admin"]', '["reviewers", "state_admin"]', false,
E'A Program Improvement Plan for {{program_name}} at {{lea_name}} has goals still open at month {{escalation_month}} of twelve. The plan is due {{pip_due}}.\n\nGoals:\n{{pip_goals_list}}\n\nThis is for your information; no approval is needed. Details are in TAPE Online: {{app_url}}\n\n{{sender_name}}'),
('scope_change', 'Change after notification', 'district', 'lea_review', 'TAPE review update: {{lea_name}}, {{review_month_year}}', '["cte_director"]', '["teachers", "reviewers", "cluster_admin", "state_admin"]', false,
E'Good morning {{director_name}},\n\nThere is a change to the TAPE review for {{lea_name}}. The current programs, reviewers, and visit dates are below and in TAPE Online: {{app_url}}\n\nVisit: {{visit_dates}}\n\nPrograms and reviewers:\n{{programs_table}}\n\nPlease reply to confirm receipt.\n\nThank you,\n{{sender_name}}\n{{sender_email}}'),
('reviewer_assignment', 'Reviewer assignment (staff only)', 'staff', 'lea_review', 'TAPE assignment: {{lea_name}}, {{review_month_year}}', '["reviewers"]', '["cluster_admin", "state_admin"]', false,
E'You are assigned to the TAPE review of {{lea_name}} in {{review_month_year}}. Visit: {{visit_dates}}. Notification to the system releases on {{notification_date}}; nothing about the selection reaches the system before then.\n\nPrograms:\n{{programs_table}}\n\nOffer visit date choices and review the evidence in TAPE Online: {{app_url}}\n\n{{sender_name}}')
on conflict (step_key) do nothing;
end;
$seed$;
select app.seed_default_templates();
