-- 0007: evidence files, Form 14-1, credential results, and Director self-scores.
--
-- Files live in a private storage bucket under random keys. The database holds
-- the metadata, the scan result, the quarantine flag, and every signed link
-- ever issued. A link can be issued only when an evidence_access row can be
-- inserted, and that insert is gated by policy: the caller must be allowed to
-- see the file, the scan must be clean, and the file must not be quarantined
-- or removed.

create type app.scan_status as enum ('pending', 'clean', 'infected', 'failed');
create type app.score_value as enum ('1', '2', 'NA');

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------
create table public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  school_year_id uuid not null references public.school_years (id),
  declared_program_id uuid not null references public.declared_programs (id),
  program_code text not null references public.program_catalog (code),
  school_id uuid references public.schools (id),
  teacher_id uuid references public.teachers (id),
  category text not null default 'evidence' check (category in ('evidence', 'form_141_scan', 'spp_report', 'credential_report')),
  form_year_label text,
  storage_key text not null unique,
  original_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text,
  note text,
  uploaded_by uuid not null references public.profiles (id),
  scan_status app.scan_status not null default 'pending',
  scanner text,
  scan_detail text,
  scanned_at timestamptz,
  quarantined boolean not null default false,
  quarantine_reason text,
  quarantined_by uuid references public.profiles (id),
  quarantined_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index evidence_files_program on public.evidence_files (declared_program_id);
create index evidence_files_lea_year on public.evidence_files (lea_id, school_year_id);

create table public.evidence_qpi_links (
  file_id uuid not null references public.evidence_files (id) on delete cascade,
  qpi_code text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (file_id, qpi_code)
);

create table public.evidence_access (
  id bigint generated always as identity primary key,
  file_id uuid not null references public.evidence_files (id),
  user_id uuid not null references public.profiles (id),
  purpose text not null default 'view' check (purpose in ('view', 'download', 'scan')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index evidence_access_file on public.evidence_access (file_id, issued_at desc);
create trigger evidence_access_immutable before update or delete on public.evidence_access for each row execute function app.reject_change();

-- ---------------------------------------------------------------------------
-- Form 14-1 and credential results
-- ---------------------------------------------------------------------------
create table public.form_141 (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  school_year_id uuid not null references public.school_years (id),
  declared_program_id uuid not null unique references public.declared_programs (id),
  instrument_version_id uuid references public.instrument_versions (id),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  ta_requested_level1 boolean not null default false,
  ta_requested_new_teacher boolean not null default false,
  comments text,
  completed_by uuid references public.profiles (id),
  submitted_by uuid references public.profiles (id),
  submitted_at timestamptz,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.form_141_items (
  form_id uuid not null references public.form_141 (id) on delete cascade,
  qpi_code text not null,
  score app.score_value,
  corrective_action text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (form_id, qpi_code)
);

create table public.credential_results (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  school_year_id uuid not null references public.school_years (id),
  declared_program_id uuid not null references public.declared_programs (id),
  credential_name text not null,
  test_takers integer not null check (test_takers >= 0),
  passers integer not null check (passers >= 0),
  source_file_id uuid references public.evidence_files (id),
  entered_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (passers <= test_takers)
);
create index credential_results_program on public.credential_results (declared_program_id);

-- ---------------------------------------------------------------------------
-- Scores: insert-only entries, a view for the current one
-- ---------------------------------------------------------------------------
create table public.score_entries (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.program_review_sites (id),
  qpi_code text not null,
  scorer_role text not null check (scorer_role in ('director', 'reviewer')),
  value app.score_value not null,
  na_reason text,
  comment text,
  version integer not null default 1,
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (value <> 'NA' or (na_reason is not null and length(trim(na_reason)) > 0))
);
create index score_entries_site on public.score_entries (site_id, qpi_code, scorer_role, version desc);
create trigger score_entries_immutable before update or delete on public.score_entries for each row execute function app.reject_change();

create or replace function app.next_score_version() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select coalesce(max(e.version), 0) + 1 into new.version from public.score_entries e
    where e.site_id = new.site_id and e.qpi_code = new.qpi_code and e.scorer_role = new.scorer_role;
  return new;
end;
$$;
create trigger score_entries_version before insert on public.score_entries for each row execute function app.next_score_version();

create or replace view public.current_scores with (security_invoker = true) as
  select distinct on (e.site_id, e.qpi_code, e.scorer_role) e.*
  from public.score_entries e
  order by e.site_id, e.qpi_code, e.scorer_role, e.version desc;
grant select on public.current_scores to authenticated;

alter table public.program_review_sites
  add column director_submitted_at timestamptz,
  add column director_submitted_by uuid references public.profiles (id),
  add column scoring_extended_until date;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.site_program_review(p_site uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select s.program_review_id from public.program_review_sites s where s.id = p_site; $$;

create or replace function app.site_lea(p_site uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select r.lea_id from public.program_review_sites s
  join public.program_reviews p on p.id = s.program_review_id
  join public.lea_reviews r on r.id = p.lea_review_id
  where s.id = p_site;
$$;

-- The review site that belongs to a declared program this year, if it was selected.
create or replace function app.site_for_declared_program(p_dp uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id from public.declared_programs d
  join public.review_cycles c on c.school_year_id = d.school_year_id
  join public.lea_reviews r on r.cycle_id = c.id and r.lea_id = d.lea_id
  join public.program_reviews p on p.lea_review_id = r.id and p.program_code = d.program_code and p.status <> 'removed'
  join public.program_review_sites s on s.program_review_id = p.id and s.school_id is not distinct from d.home_school_id
  where d.id = p_dp
  limit 1;
$$;

-- A reviewer assigned to any program review of this program in this LEA and year.
create or replace function app.reviewer_for_program(p_lea uuid, p_year uuid, p_program text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.review_assignments a
    join public.program_reviews p on p.id = a.program_review_id
    join public.lea_reviews r on r.id = p.lea_review_id
    join public.review_cycles c on c.id = r.cycle_id
    where a.user_id = auth.uid() and a.revoked_at is null and r.lea_id = p_lea and c.school_year_id = p_year and p.program_code = p_program
  );
$$;

-- Staff scope over a program in an LEA and year. Leadership is excluded on purpose: no evidence.
create or replace function app.staff_sees_program(p_lea uuid, p_year uuid, p_program text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_state_admin()
    or (app.has_role('cluster_admin') and app.cluster_admin_for_program(p_program))
    or app.reviewer_for_program(p_lea, p_year, p_program);
$$;

create or replace function app.district_sees_program(p_lea uuid, p_dp uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select app.manages_lea(p_lea) or app.teacher_on_declared_program(p_dp); $$;

create or replace function app.can_see_evidence(p_file uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_files f
    where f.id = p_file and (
      app.staff_sees_program(f.lea_id, f.school_year_id, f.program_code)
      or (app.district_sees_program(f.lea_id, f.declared_program_id) and not f.quarantined)
    )
  );
$$;

-- May a signed link be issued to the caller right now.
create or replace function app.evidence_readable(p_file uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_files f
    where f.id = p_file and f.scan_status = 'clean' and not f.quarantined and f.removed_at is null and app.can_see_evidence(f.id)
  );
$$;

create or replace function app.may_edit_evidence(p_file uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_files f
    where f.id = p_file and f.removed_at is null and (f.uploaded_by = auth.uid() or app.manages_lea(f.lea_id) or app.is_state_admin())
  );
$$;

-- Director self-scoring is open after release, before submission, until the evidence due date (or an admin extension).
create or replace function app.self_scoring_open(p_site uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.program_review_sites s
    join public.program_reviews p on p.id = s.program_review_id
    join public.lea_reviews r on r.id = p.lea_review_id
    where s.id = p_site and r.released_at is not null and s.director_submitted_at is null and p.status <> 'removed'
      and coalesce(s.scoring_extended_until, app.milestone_date(r.id, 'evidence_due'), current_date) >= current_date
  );
$$;

grant execute on function app.site_program_review(uuid), app.site_lea(uuid), app.site_for_declared_program(uuid), app.reviewer_for_program(uuid, uuid, text),
  app.staff_sees_program(uuid, uuid, text), app.district_sees_program(uuid, uuid), app.can_see_evidence(uuid), app.evidence_readable(uuid), app.may_edit_evidence(uuid), app.self_scoring_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Actions as functions, so the rules live here and not in a page
-- ---------------------------------------------------------------------------
create or replace function app.remove_evidence(p_file uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.authed() or not app.may_edit_evidence(p_file) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.evidence_files set removed_at = now(), removed_by = auth.uid(), note = coalesce(note, '') || case when p_reason is null or p_reason = '' then '' else E'\nRemoved: ' || p_reason end where id = p_file and removed_at is null;
end;
$$;

create or replace function app.quarantine_evidence(p_file uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare f public.evidence_files%rowtype;
begin
  select * into f from public.evidence_files where id = p_file;
  if f.id is null then raise exception 'file not found'; end if;
  if not app.authed() or not app.staff_sees_program(f.lea_id, f.school_year_id, f.program_code) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 2 then raise exception 'a reason is required'; end if;
  update public.evidence_files set quarantined = true, quarantine_reason = p_reason, quarantined_by = auth.uid(), quarantined_at = now() where id = p_file;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'evidence.quarantined', 'evidence_files', p_file::text, f.lea_id, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function app.release_quarantine(p_file uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare f public.evidence_files%rowtype;
begin
  if not app.authed() or not app.is_state_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into f from public.evidence_files where id = p_file;
  update public.evidence_files set quarantined = false, quarantine_reason = null, quarantined_by = null, quarantined_at = null where id = p_file;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'evidence.quarantine_released', 'evidence_files', p_file::text, f.lea_id, jsonb_build_object('reason', p_reason));
end;
$$;

-- Director submission: 2.1.A to 2.1.D must carry a 1 or 2. Freezes self-scores.
create or replace function app.submit_director_scores(p_site uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_lea uuid; missing text; v_pr uuid;
begin
  v_lea := app.site_lea(p_site);
  if not app.authed() or not app.directs_lea(v_lea) then raise exception 'only the CTE Director can submit' using errcode = '42501'; end if;
  if not app.self_scoring_open(p_site) then raise exception 'self-scoring is not open for this program'; end if;
  select string_agg(code, ', ') into missing from unnest(array['2.1.A', '2.1.B', '2.1.C', '2.1.D']) as code
    where not exists (select 1 from public.current_scores c where c.site_id = p_site and c.qpi_code = code and c.scorer_role = 'director' and c.value in ('1', '2'));
  if missing is not null then raise exception 'score 1 or 2 is required for %', missing; end if;
  v_pr := app.site_program_review(p_site);
  update public.program_review_sites set director_submitted_at = now(), director_submitted_by = auth.uid() where id = p_site;
  update public.program_reviews set status = 'evidence_submitted', updated_at = now() where id = v_pr and status in ('released', 'selected');
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id)
  values (auth.uid(), auth.role(), 'self_scores.submitted', 'program_review_sites', p_site::text, v_lea);
end;
$$;

create or replace function app.reopen_director_scores(p_site uuid, p_reason text, p_until date) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.authed() or not app.is_state_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 2 then raise exception 'a reason is required'; end if;
  update public.program_review_sites set director_submitted_at = null, director_submitted_by = null, scoring_extended_until = p_until where id = p_site;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'self_scores.reopened', 'program_review_sites', p_site::text, app.site_lea(p_site), jsonb_build_object('reason', p_reason, 'until', p_until));
end;
$$;

create or replace function app.submit_form_141(p_form uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare f public.form_141%rowtype;
begin
  select * into f from public.form_141 where id = p_form;
  if f.id is null then raise exception 'form not found'; end if;
  if not app.authed() or not app.directs_lea(f.lea_id) then raise exception 'only the CTE Director can submit Form 14-1' using errcode = '42501'; end if;
  if f.status = 'submitted' then raise exception 'already submitted'; end if;
  if not exists (select 1 from public.form_141_items i where i.form_id = p_form and i.score is not null) then raise exception 'score at least one item before submitting'; end if;
  update public.form_141 set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now() where id = p_form;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id)
  values (auth.uid(), auth.role(), 'form_141.submitted', 'form_141', p_form::text, f.lea_id);
end;
$$;

create or replace function app.reopen_form_141(p_form uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.authed() or not app.is_state_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.form_141 set status = 'draft', reopened_at = now(), reopen_reason = p_reason, updated_at = now() where id = p_form;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, meta)
  values (auth.uid(), auth.role(), 'form_141.reopened', 'form_141', p_form::text, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function app.remove_evidence(uuid, text), app.quarantine_evidence(uuid, text), app.release_quarantine(uuid, text), app.submit_director_scores(uuid),
  app.reopen_director_scores(uuid, text, date), app.submit_form_141(uuid), app.reopen_form_141(uuid, text) to authenticated;

create or replace function public.remove_evidence(p_file uuid, p_reason text default null) returns void language sql security invoker set search_path = '' as $$ select app.remove_evidence(p_file, p_reason); $$;
create or replace function public.quarantine_evidence(p_file uuid, p_reason text) returns void language sql security invoker set search_path = '' as $$ select app.quarantine_evidence(p_file, p_reason); $$;
create or replace function public.release_quarantine(p_file uuid, p_reason text default null) returns void language sql security invoker set search_path = '' as $$ select app.release_quarantine(p_file, p_reason); $$;
create or replace function public.submit_director_scores(p_site uuid) returns void language sql security invoker set search_path = '' as $$ select app.submit_director_scores(p_site); $$;
create or replace function public.reopen_director_scores(p_site uuid, p_reason text, p_until date default null) returns void language sql security invoker set search_path = '' as $$ select app.reopen_director_scores(p_site, p_reason, p_until); $$;
create or replace function public.submit_form_141(p_form uuid) returns void language sql security invoker set search_path = '' as $$ select app.submit_form_141(p_form); $$;
create or replace function public.reopen_form_141(p_form uuid, p_reason text default null) returns void language sql security invoker set search_path = '' as $$ select app.reopen_form_141(p_form, p_reason); $$;
create or replace function public.site_for_declared_program(p_dp uuid) returns uuid language sql security invoker set search_path = '' as $$ select app.site_for_declared_program(p_dp); $$;
create or replace function public.self_scoring_open(p_site uuid) returns boolean language sql security invoker set search_path = '' as $$ select app.self_scoring_open(p_site); $$;
grant execute on function public.remove_evidence(uuid, text), public.quarantine_evidence(uuid, text), public.release_quarantine(uuid, text), public.submit_director_scores(uuid),
  public.reopen_director_scores(uuid, text, date), public.submit_form_141(uuid), public.reopen_form_141(uuid, text), public.site_for_declared_program(uuid), public.self_scoring_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['evidence_files', 'evidence_qpi_links', 'form_141', 'form_141_items', 'credential_results', 'score_entries']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.evidence_files enable row level security;
alter table public.evidence_qpi_links enable row level security;
alter table public.evidence_access enable row level security;
alter table public.form_141 enable row level security;
alter table public.form_141_items enable row level security;
alter table public.credential_results enable row level security;
alter table public.score_entries enable row level security;

grant select, insert, update on public.evidence_files, public.form_141, public.form_141_items, public.credential_results to authenticated;
grant select, insert, delete on public.evidence_qpi_links to authenticated;
grant select, insert on public.evidence_access, public.score_entries to authenticated;
grant delete on public.credential_results to authenticated;

-- Evidence: metadata is visible to those in scope; quarantined files vanish for district roles; removed files are admin only.
-- Written against the row's own columns (not a lookup by id) so the policy also holds for insert ... returning.
create policy evidence_files_read on public.evidence_files for select to authenticated using (
  app.authed()
  and (app.staff_sees_program(lea_id, school_year_id, program_code) or (app.district_sees_program(lea_id, declared_program_id) and not quarantined))
  and (removed_at is null or app.is_state_admin())
);
create policy evidence_files_upload on public.evidence_files for insert to authenticated with check (
  app.authed() and uploaded_by = auth.uid() and scan_status = 'pending' and not quarantined and removed_at is null
  and app.district_sees_program(lea_id, declared_program_id)
  and exists (select 1 from public.declared_programs d where d.id = evidence_files.declared_program_id and d.lea_id = evidence_files.lea_id and d.school_year_id = evidence_files.school_year_id and d.program_code = evidence_files.program_code)
);
create policy evidence_files_admin on public.evidence_files for update to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy evidence_qpi_links_read on public.evidence_qpi_links for select to authenticated using (app.authed() and app.can_see_evidence(file_id));
create policy evidence_qpi_links_write on public.evidence_qpi_links for insert to authenticated with check (app.authed() and app.may_edit_evidence(file_id));
create policy evidence_qpi_links_delete on public.evidence_qpi_links for delete to authenticated using (app.authed() and app.may_edit_evidence(file_id));

-- The gate for signed links.
create policy evidence_access_insert on public.evidence_access for insert to authenticated with check (app.authed() and user_id = auth.uid() and app.evidence_readable(file_id));
create policy evidence_access_read on public.evidence_access for select to authenticated using (app.authed() and (app.is_state_admin() or user_id = auth.uid()));

-- Form 14-1: district drafts, Director submits, staff reads in scope.
create policy form_141_read on public.form_141 for select to authenticated using (
  app.authed() and (app.staff_sees_program(lea_id, school_year_id, (select d.program_code from public.declared_programs d where d.id = declared_program_id)) or app.district_sees_program(lea_id, declared_program_id))
);
create policy form_141_district_insert on public.form_141 for insert to authenticated with check (
  app.authed() and status = 'draft' and app.district_sees_program(lea_id, declared_program_id)
  and exists (select 1 from public.declared_programs d where d.id = form_141.declared_program_id and d.lea_id = form_141.lea_id and d.school_year_id = form_141.school_year_id)
);
create policy form_141_district_update on public.form_141 for update to authenticated
  using (app.authed() and status = 'draft' and app.district_sees_program(lea_id, declared_program_id))
  with check (app.authed() and status = 'draft' and app.district_sees_program(lea_id, declared_program_id));
create policy form_141_admin on public.form_141 for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy form_141_items_read on public.form_141_items for select to authenticated using (
  app.authed() and exists (select 1 from public.form_141 f where f.id = form_id)
);
create policy form_141_items_district on public.form_141_items for all to authenticated
  using (app.authed() and exists (select 1 from public.form_141 f where f.id = form_id and f.status = 'draft' and app.district_sees_program(f.lea_id, f.declared_program_id)))
  with check (app.authed() and exists (select 1 from public.form_141 f where f.id = form_id and f.status = 'draft' and app.district_sees_program(f.lea_id, f.declared_program_id)));
create policy form_141_items_admin on public.form_141_items for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy credential_results_read on public.credential_results for select to authenticated using (
  app.authed() and (app.has_role('leadership') or app.staff_sees_program(lea_id, school_year_id, (select d.program_code from public.declared_programs d where d.id = declared_program_id)) or app.district_sees_program(lea_id, declared_program_id))
);
create policy credential_results_district on public.credential_results for all to authenticated
  using (app.authed() and app.manages_lea(lea_id))
  with check (app.authed() and app.manages_lea(lea_id) and exists (select 1 from public.declared_programs d where d.id = credential_results.declared_program_id and d.lea_id = credential_results.lea_id and d.school_year_id = credential_results.school_year_id));
create policy credential_results_admin on public.credential_results for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

-- Scores: staff in scope and leadership read; Director and LEA staff read their own after release; teachers do not read scores.
create policy score_entries_read on public.score_entries for select to authenticated using (
  app.authed() and (
    app.is_state_admin() or app.has_role('leadership')
    or app.assigned_to_program_review(app.site_program_review(site_id))
    or (app.has_role('cluster_admin') and app.cluster_admin_for_program((select p.program_code from public.program_reviews p where p.id = app.site_program_review(site_id))))
    or (app.manages_lea(app.site_lea(site_id)) and app.lea_review_released((select p.lea_review_id from public.program_reviews p where p.id = app.site_program_review(site_id))))
  )
);
create policy score_entries_director on public.score_entries for insert to authenticated with check (
  app.authed() and scorer_role = 'director' and author_id = auth.uid() and app.directs_lea(app.site_lea(site_id)) and app.self_scoring_open(site_id)
);
create policy score_entries_admin on public.score_entries for insert to authenticated with check (
  app.authed() and app.is_state_admin() and author_id = auth.uid()
);
