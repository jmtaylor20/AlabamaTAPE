-- 0008: the review itself. Reviewer scores, EPIC descriptors, audit samples
-- (counts only), the onsite checklist, desk audits, section comments,
-- consistency meetings, findings, and finalization.
--
-- Finalization needs three things the database checks itself: the caller is
-- assigned (or the State Admin), a consistency meeting is recorded for the
-- LEA review, and the caller's token carries a TOTP verification from the
-- last ten minutes. A finalized program review rejects every write until the
-- State Admin reopens it with a reason.

alter table public.program_reviews add column finalized_at timestamptz, add column finalized_by uuid references public.profiles (id);

create table public.epic_scores (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.program_review_sites (id),
  descriptor_id uuid not null references public.epic_descriptors (id),
  value text not null check (value in ('met', 'not_met', 'NA')),
  na_reason text,
  comment text,
  version integer not null default 1,
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (value <> 'NA' or (na_reason is not null and length(trim(na_reason)) > 0))
);
create index epic_scores_site on public.epic_scores (site_id, descriptor_id, version desc);
create trigger epic_scores_immutable before update or delete on public.epic_scores for each row execute function app.reject_change();
create or replace function app.next_epic_version() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select coalesce(max(e.version), 0) + 1 into new.version from public.epic_scores e where e.site_id = new.site_id and e.descriptor_id = new.descriptor_id;
  return new;
end;
$$;
create trigger epic_scores_version before insert on public.epic_scores for each row execute function app.next_epic_version();
create or replace view public.current_epic_scores with (security_invoker = true) as
  select distinct on (e.site_id, e.descriptor_id) e.* from public.epic_scores e order by e.site_id, e.descriptor_id, e.version desc;
grant select on public.current_epic_scores to authenticated;

create table public.section_comments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.program_review_sites (id),
  section_code text not null,
  author_role text not null check (author_role in ('director', 'reviewer')),
  body text not null,
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, section_code, author_role)
);

-- Random audits: how many items were sampled and how many passed. Never names.
create table public.audit_samples (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.program_review_sites (id),
  qpi_code text not null,
  kind text not null check (kind in ('assurance', 'safety_exam', 'ctip', 'training_agreement', 'other')),
  items_sampled integer not null check (items_sampled >= 0),
  items_passed integer not null check (items_passed >= 0),
  chosen_by text not null default 'reviewer' check (chosen_by in ('reviewer', 'system')),
  notes text,
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (items_passed <= items_sampled)
);
create index audit_samples_site on public.audit_samples (site_id);

create table public.onsite_checks (
  site_id uuid not null references public.program_review_sites (id),
  subitem_id uuid not null references public.qpi_subitems (id),
  state text not null check (state in ('met', 'not_met', 'NA')),
  note text,
  captured_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  author_id uuid not null references public.profiles (id),
  primary key (site_id, subitem_id)
);

create table public.desk_audits (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null unique references public.program_review_sites (id),
  initial_findings text,
  sent_at timestamptz,
  sent_by uuid references public.profiles (id),
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consistency_meetings (
  id uuid primary key default gen_random_uuid(),
  lea_review_id uuid not null references public.lea_reviews (id),
  held_on date not null,
  attendees text not null,
  notes text,
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index consistency_meetings_review on public.consistency_meetings (lea_review_id);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.program_review_sites (id),
  qpi_code text not null,
  teacher_id uuid references public.teachers (id),
  body text not null,
  status text not null default 'open' check (status in ('open', 'cleared')),
  cleared_by uuid references public.profiles (id),
  cleared_at timestamptz,
  clearing_note text,
  clearing_file_id uuid references public.evidence_files (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, qpi_code, teacher_id)
);
create index findings_site on public.findings (site_id);

create table public.finalizations (
  id bigint generated always as identity primary key,
  program_review_id uuid not null references public.program_reviews (id),
  kind text not null check (kind in ('finalized', 'reopened')),
  actor_id uuid not null references public.profiles (id),
  consistency_meeting_id uuid references public.consistency_meetings (id),
  step_up_verified_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
create trigger finalizations_immutable before update or delete on public.finalizations for each row execute function app.reject_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.review_locked(p_pr uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.program_reviews p where p.id = p_pr and p.finalized_at is not null); $$;

create or replace function app.site_locked(p_site uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select app.review_locked(app.site_program_review(p_site)); $$;

-- The token must carry a TOTP verification newer than the window.
create or replace function app.fresh_mfa(p_window interval default interval '10 minutes') returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
    where m ->> 'method' = 'totp' and to_timestamp((m ->> 'timestamp')::bigint) > now() - p_window
  );
$$;

-- Who may write review records on a site: an assigned reviewer, while not locked.
create or replace function app.may_review_site(p_site uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select app.assigned_to_program_review(app.site_program_review(p_site)) and not app.site_locked(p_site); $$;

-- District roles read reviewer records once the review is finalized.
create or replace function app.district_reads_site(p_site uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select app.manages_lea(app.site_lea(p_site)) and app.site_locked(p_site); $$;

create or replace function app.staff_reads_site(p_site uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_state_admin() or app.has_role('leadership')
    or app.assigned_to_program_review(app.site_program_review(p_site))
    or (app.has_role('cluster_admin') and app.cluster_admin_for_program((select p.program_code from public.program_reviews p where p.id = app.site_program_review(p_site))));
$$;

-- The indicator codes that apply to a site, from the instrument flags and the declaration.
create or replace function app.applicable_qpi_codes(p_site uuid) returns setof text
language sql stable security definer set search_path = ''
as $$
  with ctx as (
    select p.program_code, p.instrument_version_id, r.lea_id, c.school_year_id, s.school_id, cat.is_coop
    from public.program_review_sites s
    join public.program_reviews p on p.id = s.program_review_id
    join public.lea_reviews r on r.id = p.lea_review_id
    join public.review_cycles c on c.id = r.cycle_id
    join public.program_catalog cat on cat.code = p.program_code
    where s.id = p_site
  ), decl as (
    select d.delivery_type, d.dual_scenario, d.ase_accredited from ctx join public.declared_programs d
      on d.lea_id = ctx.lea_id and d.school_year_id = ctx.school_year_id and d.program_code = ctx.program_code and d.home_school_id is not distinct from ctx.school_id
    limit 1
  )
  select q.code from ctx, public.qpis q
  left join decl on true
  where q.version_id = ctx.instrument_version_id
    and (case when ctx.is_coop then q.applies_to <> 'non_coop' else q.applies_to <> 'coop_only' end)
    and (not (coalesce(decl.delivery_type, 'LOCAL') = 'DUAL' and decl.dual_scenario = 3) or q.dual_scenario3_included)
    and not (coalesce(decl.ase_accredited, false) and q.satisfied_by_ase);
$$;

grant execute on function app.review_locked(uuid), app.site_locked(uuid), app.fresh_mfa(interval), app.may_review_site(uuid), app.district_reads_site(uuid), app.staff_reads_site(uuid), app.applicable_qpi_codes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create or replace function app.send_desk_audit(p_site uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_pr uuid; v_lr uuid;
begin
  if not app.authed() or not (app.may_review_site(p_site) or app.is_state_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if app.site_locked(p_site) then raise exception 'this review is finalized'; end if;
  update public.desk_audits set sent_at = now(), sent_by = auth.uid(), updated_at = now() where site_id = p_site and sent_at is null;
  if not found then raise exception 'write the initial findings first, or the desk audit was already sent'; end if;
  v_pr := app.site_program_review(p_site);
  update public.program_reviews set status = 'desk_audit', updated_at = now() where id = v_pr and status in ('released', 'evidence_submitted');
  select lea_review_id into v_lr from public.program_reviews where id = v_pr;
  update public.lea_reviews set status = 'desk_audit', updated_at = now() where id = v_lr and status in ('released', 'evidence_due');
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id)
  values (auth.uid(), auth.role(), 'desk_audit.sent', 'program_review_sites', p_site::text, app.site_lea(p_site));
end;
$$;

create or replace function app.finalize_program_review(p_pr uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.program_reviews%rowtype; v_meeting uuid; v_site record; missing text; v_mfa timestamptz;
begin
  select * into r from public.program_reviews where id = p_pr;
  if r.id is null then raise exception 'review not found'; end if;
  if not app.authed() or not (app.assigned_to_program_review(p_pr) or app.is_state_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.finalized_at is not null then raise exception 'already finalized'; end if;
  -- Completeness first, then the meeting, then the fresh verification, so the reviewer sees what to fix before re-verifying.
  for v_site in select s.id from public.program_review_sites s where s.program_review_id = p_pr loop
    select string_agg(code, ', ' order by code) into missing from app.applicable_qpi_codes(v_site.id) code
      where not exists (select 1 from public.current_scores c where c.site_id = v_site.id and c.qpi_code = code and c.scorer_role = 'reviewer');
    if missing is not null then raise exception 'reviewer score missing for %', missing; end if;
  end loop;
  select id into v_meeting from public.consistency_meetings where lea_review_id = r.lea_review_id order by held_on desc limit 1;
  if v_meeting is null then raise exception 'a consistency meeting must be recorded for this system before finalizing'; end if;
  if not app.fresh_mfa() then raise exception 'verify your authenticator code again before finalizing' using errcode = '28000'; end if;
  for v_site in select s.id from public.program_review_sites s where s.program_review_id = p_pr loop
    -- A finding is a reviewer score of 1. Create one per indicator that does not already have one.
    insert into public.findings (site_id, qpi_code, body, created_by)
    select c.site_id, c.qpi_code, coalesce(nullif(trim(c.comment), ''), 'Level 1 on ' || c.qpi_code), auth.uid()
    from public.current_scores c
    where c.site_id = v_site.id and c.scorer_role = 'reviewer' and c.value = '1'
      and not exists (select 1 from public.findings f where f.site_id = c.site_id and f.qpi_code = c.qpi_code);
  end loop;
  select max(to_timestamp((m ->> 'timestamp')::bigint)) into v_mfa from jsonb_array_elements(auth.jwt() -> 'amr') m where m ->> 'method' = 'totp';
  update public.program_reviews set finalized_at = now(), finalized_by = auth.uid(), status = 'finalized', updated_at = now() where id = p_pr;
  insert into public.finalizations (program_review_id, kind, actor_id, consistency_meeting_id, step_up_verified_at) values (p_pr, 'finalized', auth.uid(), v_meeting, v_mfa);
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'program_review.finalized', 'program_reviews', p_pr::text, (select lea_id from public.lea_reviews where id = r.lea_review_id), jsonb_build_object('meeting', v_meeting));
end;
$$;

create or replace function app.reopen_program_review(p_pr uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.program_reviews%rowtype;
begin
  if not app.authed() or not app.is_state_admin() then raise exception 'only the State Admin can reopen a finalized review' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required to reopen'; end if;
  select * into r from public.program_reviews where id = p_pr;
  if r.finalized_at is null then raise exception 'this review is not finalized'; end if;
  update public.program_reviews set finalized_at = null, finalized_by = null, status = 'post_visit', updated_at = now() where id = p_pr;
  insert into public.finalizations (program_review_id, kind, actor_id, reason) values (p_pr, 'reopened', auth.uid(), p_reason);
  insert into public.scope_changes (lea_review_id, kind, reason, details, inform, actor_id) values (r.lea_review_id, 'reopened', p_reason, jsonb_build_object('program_review', p_pr), '["director", "reviewers"]'::jsonb, auth.uid());
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'program_review.reopened', 'program_reviews', p_pr::text, (select lea_id from public.lea_reviews where id = r.lea_review_id), jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function app.clear_finding(p_finding uuid, p_note text, p_file uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare f public.findings%rowtype;
begin
  select * into f from public.findings where id = p_finding;
  if f.id is null then raise exception 'finding not found'; end if;
  if not app.authed() or not (app.assigned_to_program_review(app.site_program_review(f.site_id)) or app.is_state_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_note is null or length(trim(p_note)) < 2 then raise exception 'say what evidence cleared the finding'; end if;
  update public.findings set status = 'cleared', cleared_by = auth.uid(), cleared_at = now(), clearing_note = p_note, clearing_file_id = p_file, updated_at = now() where id = p_finding and status = 'open';
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'finding.cleared', 'findings', p_finding::text, app.site_lea(f.site_id), jsonb_build_object('qpi', f.qpi_code));
end;
$$;

grant execute on function app.send_desk_audit(uuid), app.finalize_program_review(uuid), app.reopen_program_review(uuid, text), app.clear_finding(uuid, text, uuid) to authenticated;
create or replace function public.send_desk_audit(p_site uuid) returns void language sql security invoker set search_path = '' as $$ select app.send_desk_audit(p_site); $$;
create or replace function public.finalize_program_review(p_pr uuid) returns void language sql security invoker set search_path = '' as $$ select app.finalize_program_review(p_pr); $$;
create or replace function public.reopen_program_review(p_pr uuid, p_reason text) returns void language sql security invoker set search_path = '' as $$ select app.reopen_program_review(p_pr, p_reason); $$;
create or replace function public.clear_finding(p_finding uuid, p_note text, p_file uuid default null) returns void language sql security invoker set search_path = '' as $$ select app.clear_finding(p_finding, p_note, p_file); $$;
create or replace function public.applicable_qpi_codes(p_site uuid) returns setof text language sql security invoker set search_path = '' as $$ select app.applicable_qpi_codes(p_site); $$;
create or replace function public.fresh_mfa() returns boolean language sql security invoker set search_path = '' as $$ select app.fresh_mfa(); $$;
grant execute on function public.send_desk_audit(uuid), public.finalize_program_review(uuid), public.reopen_program_review(uuid, text), public.clear_finding(uuid, text, uuid), public.applicable_qpi_codes(uuid), public.fresh_mfa() to authenticated;

-- ---------------------------------------------------------------------------
-- Audit triggers and row-level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['epic_scores', 'section_comments', 'audit_samples', 'onsite_checks', 'desk_audits', 'consistency_meetings', 'findings']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

alter table public.epic_scores enable row level security;
alter table public.section_comments enable row level security;
alter table public.audit_samples enable row level security;
alter table public.onsite_checks enable row level security;
alter table public.desk_audits enable row level security;
alter table public.consistency_meetings enable row level security;
alter table public.findings enable row level security;
alter table public.finalizations enable row level security;

grant select, insert on public.epic_scores, public.finalizations to authenticated;
grant select, insert, update on public.section_comments, public.audit_samples, public.onsite_checks, public.desk_audits, public.consistency_meetings, public.findings to authenticated;
grant delete on public.audit_samples to authenticated;

-- Reviewer scores join the Director's table. Reviewers write only on assigned, unlocked sites.
create policy score_entries_reviewer on public.score_entries for insert to authenticated with check (
  app.authed() and scorer_role = 'reviewer' and author_id = auth.uid() and app.may_review_site(site_id)
);
drop policy score_entries_admin on public.score_entries;
create policy score_entries_admin on public.score_entries for insert to authenticated with check (
  app.authed() and app.is_state_admin() and author_id = auth.uid() and not app.site_locked(site_id)
);
-- District roles read reviewer scores only after finalization (Director scores they already read after release).
drop policy score_entries_read on public.score_entries;
create policy score_entries_read on public.score_entries for select to authenticated using (
  app.authed() and (
    app.staff_reads_site(site_id)
    or (scorer_role = 'director' and app.manages_lea(app.site_lea(site_id)) and app.lea_review_released((select p.lea_review_id from public.program_reviews p where p.id = app.site_program_review(site_id))))
    or (scorer_role = 'reviewer' and app.district_reads_site(site_id))
  )
);

create policy epic_scores_read on public.epic_scores for select to authenticated using (app.authed() and (app.staff_reads_site(site_id) or app.district_reads_site(site_id)));
create policy epic_scores_write on public.epic_scores for insert to authenticated with check (app.authed() and author_id = auth.uid() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))));

create policy section_comments_read on public.section_comments for select to authenticated using (
  app.authed() and (app.staff_reads_site(site_id) or (author_role = 'director' and app.manages_lea(app.site_lea(site_id))) or (author_role = 'reviewer' and app.district_reads_site(site_id)))
);
create policy section_comments_reviewer on public.section_comments for all to authenticated
  using (app.authed() and author_role = 'reviewer' and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))))
  with check (app.authed() and author_role = 'reviewer' and author_id = auth.uid() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))));
create policy section_comments_director on public.section_comments for all to authenticated
  using (app.authed() and author_role = 'director' and app.directs_lea(app.site_lea(site_id)) and app.self_scoring_open(site_id))
  with check (app.authed() and author_role = 'director' and author_id = auth.uid() and app.directs_lea(app.site_lea(site_id)) and app.self_scoring_open(site_id));

create policy audit_samples_read on public.audit_samples for select to authenticated using (app.authed() and (app.staff_reads_site(site_id) or app.district_reads_site(site_id)));
create policy audit_samples_write on public.audit_samples for all to authenticated
  using (app.authed() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))))
  with check (app.authed() and author_id = auth.uid() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))));

create policy onsite_checks_read on public.onsite_checks for select to authenticated using (app.authed() and (app.staff_reads_site(site_id) or app.district_reads_site(site_id)));
create policy onsite_checks_write on public.onsite_checks for all to authenticated
  using (app.authed() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))))
  with check (app.authed() and author_id = auth.uid() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))));

-- Desk audits: the Director sees them once sent.
create policy desk_audits_read on public.desk_audits for select to authenticated using (
  app.authed() and (app.staff_reads_site(site_id) or (sent_at is not null and app.manages_lea(app.site_lea(site_id))))
);
create policy desk_audits_write on public.desk_audits for all to authenticated
  using (app.authed() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))))
  with check (app.authed() and author_id = auth.uid() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))));

create policy consistency_meetings_read on public.consistency_meetings for select to authenticated using (app.authed() and app.is_staff());
create policy consistency_meetings_write on public.consistency_meetings for all to authenticated
  using (app.authed() and (app.is_state_admin() or app.assigned_in_lea_review(lea_review_id)))
  with check (app.authed() and recorded_by = auth.uid() and (app.is_state_admin() or app.assigned_in_lea_review(lea_review_id)));

-- Findings: staff in scope; the Director and the program's teacher once finalized; leadership gets counts elsewhere, not text.
create policy findings_read on public.findings for select to authenticated using (
  app.authed() and (
    app.is_state_admin() or app.assigned_to_program_review(app.site_program_review(site_id))
    or (app.has_role('cluster_admin') and app.cluster_admin_for_program((select p.program_code from public.program_reviews p where p.id = app.site_program_review(site_id))))
    or app.district_reads_site(site_id)
    or (app.site_locked(site_id) and exists (select 1 from public.program_review_site_teachers t where t.site_id = findings.site_id and t.teacher_id = app.my_teacher_id()))
  )
);
create policy findings_write on public.findings for all to authenticated
  using (app.authed() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))))
  with check (app.authed() and (app.may_review_site(site_id) or (app.is_state_admin() and not app.site_locked(site_id))));

create policy finalizations_read on public.finalizations for select to authenticated using (app.authed() and (app.is_staff() or app.manages_lea((select lea_id from public.lea_reviews r join public.program_reviews p on p.lea_review_id = r.id where p.id = program_review_id))));
