-- 0011: operations. Rate limiting, retention classes with eligibility
-- reporting (never destruction), and the aggregate counts leadership and
-- dashboards read without touching evidence or finding text.

-- ---------------------------------------------------------------------------
-- Rate limiting: a fixed window per key, consumed by the sign-in and upload paths.
-- Keys are hashed by the caller so no address is stored in clear.
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);
alter table public.rate_limits enable row level security;

create or replace function app.consume_rate_limit(p_key text, p_max integer, p_window interval) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare r public.rate_limits%rowtype;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when public.rate_limits.window_start + p_window < now() then 1 else public.rate_limits.hits + 1 end,
    window_start = case when public.rate_limits.window_start + p_window < now() then now() else public.rate_limits.window_start end
  returning * into r;
  return r.hits <= p_max;
end;
$$;
create or replace function public.consume_rate_limit(p_key text, p_max integer, p_window_seconds integer) returns boolean
language sql security invoker set search_path = '' as $$ select app.consume_rate_limit(p_key, p_max, make_interval(secs => p_window_seconds)); $$;
grant execute on function app.consume_rate_limit(text, integer, interval) to anon, authenticated, service_role;
grant execute on function public.consume_rate_limit(text, integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Retention: one row per record class, years configurable, eligibility reported, nothing deleted here.
-- ---------------------------------------------------------------------------
create table public.retention_policies (
  record_class text primary key check (record_class in ('reviews', 'findings', 'pips', 'declarations', 'evidence_files', 'audit_events', 'email_drafts')),
  years integer not null check (years between 1 and 50),
  basis text not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
-- Defaults in a re-runnable function (the test suites seed it after their resets).
create or replace function app.seed_retention_policies() returns void
language sql security definer set search_path = ''
as $$
  insert into public.retention_policies (record_class, years, basis) values
    ('reviews', 7, 'Placeholder pending the ALSDE records schedule: scores, reports, and review records'),
    ('findings', 7, 'Placeholder pending the ALSDE records schedule'),
    ('pips', 7, 'Placeholder pending the ALSDE records schedule'),
    ('declarations', 7, 'Placeholder pending the ALSDE records schedule'),
    ('evidence_files', 5, 'Placeholder pending the ALSDE records schedule and FERPA guidance on district evidence'),
    ('audit_events', 7, 'Placeholder pending the ALSDE records schedule'),
    ('email_drafts', 7, 'Placeholder pending the ALSDE records schedule')
  on conflict (record_class) do nothing;
$$;
select app.seed_retention_policies();
alter table public.retention_policies enable row level security;
grant select, update on public.retention_policies to authenticated;
create policy retention_read on public.retention_policies for select to authenticated using (app.authed() and app.is_state_admin());
create policy retention_write on public.retention_policies for update to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create trigger audit_retention_policies after update on public.retention_policies for each row execute function app.audit_row_change();

-- Counts of records past their class's years. Reporting only; destruction is a separate, logged State Admin action that does not exist yet.
create or replace function app.retention_report() returns table (record_class text, years integer, total bigint, eligible bigint, oldest date)
language sql stable security definer set search_path = ''
as $$
  select p.record_class, p.years,
    case p.record_class
      when 'reviews' then (select count(*) from public.lea_reviews)
      when 'findings' then (select count(*) from public.findings)
      when 'pips' then (select count(*) from public.pips)
      when 'declarations' then (select count(*) from public.declared_programs)
      when 'evidence_files' then (select count(*) from public.evidence_files)
      when 'audit_events' then (select count(*) from public.audit_events)
      when 'email_drafts' then (select count(*) from public.email_drafts)
    end,
    case p.record_class
      when 'reviews' then (select count(*) from public.lea_reviews r where r.created_at < now() - make_interval(years => p.years))
      when 'findings' then (select count(*) from public.findings f where f.created_at < now() - make_interval(years => p.years))
      when 'pips' then (select count(*) from public.pips x where x.created_at < now() - make_interval(years => p.years))
      when 'declarations' then (select count(*) from public.declared_programs d where d.created_at < now() - make_interval(years => p.years))
      when 'evidence_files' then (select count(*) from public.evidence_files e where e.created_at < now() - make_interval(years => p.years))
      when 'audit_events' then (select count(*) from public.audit_events a where a.occurred_at < now() - make_interval(years => p.years))
      when 'email_drafts' then (select count(*) from public.email_drafts m where m.created_at < now() - make_interval(years => p.years))
    end,
    case p.record_class
      when 'reviews' then (select min(r.created_at)::date from public.lea_reviews r)
      when 'findings' then (select min(f.created_at)::date from public.findings f)
      when 'pips' then (select min(x.created_at)::date from public.pips x)
      when 'declarations' then (select min(d.created_at)::date from public.declared_programs d)
      when 'evidence_files' then (select min(e.created_at)::date from public.evidence_files e)
      when 'audit_events' then (select min(a.occurred_at)::date from public.audit_events a)
      when 'email_drafts' then (select min(m.created_at)::date from public.email_drafts m)
    end
  from public.retention_policies p
  where app.authed() and app.is_state_admin()
  order by p.record_class;
$$;
create or replace function public.retention_report() returns table (record_class text, years integer, total bigint, eligible bigint, oldest date) language sql security invoker set search_path = '' as $$ select * from app.retention_report(); $$;
grant execute on function app.retention_report(), public.retention_report() to authenticated;

-- ---------------------------------------------------------------------------
-- Aggregates for leadership and dashboards: numbers only, scoped by role.
-- Leadership sees everything as counts. Cluster administrators see their
-- clusters. Reviewers see their assignments. District roles see their LEA.
-- ---------------------------------------------------------------------------
create or replace function app.review_counts(p_school_year uuid default null)
returns table (lea_id uuid, lea_name text, program_code text, program_name text, cluster_code text, review_month integer, review_year integer, status text, released boolean, finalized boolean, level2 bigint, level1 bigint, na bigint, open_findings bigint, cleared_findings bigint, pip_status text, pip_due date)
language sql stable security definer set search_path = ''
as $$
  select r.lea_id, l.name, p.program_code, c.name, c.cluster_code, r.review_month, r.review_year, p.status::text, r.released_at is not null, p.finalized_at is not null,
    (select count(*) from public.current_scores s join public.program_review_sites st on st.id = s.site_id where st.program_review_id = p.id and s.scorer_role = 'reviewer' and s.value = '2'),
    (select count(*) from public.current_scores s join public.program_review_sites st on st.id = s.site_id where st.program_review_id = p.id and s.scorer_role = 'reviewer' and s.value = '1'),
    (select count(*) from public.current_scores s join public.program_review_sites st on st.id = s.site_id where st.program_review_id = p.id and s.scorer_role = 'reviewer' and s.value = 'NA'),
    (select count(*) from public.findings f join public.program_review_sites st on st.id = f.site_id where st.program_review_id = p.id and f.status = 'open'),
    (select count(*) from public.findings f join public.program_review_sites st on st.id = f.site_id where st.program_review_id = p.id and f.status = 'cleared'),
    (select x.status from public.pips x where x.program_review_id = p.id),
    (select x.due_on from public.pips x where x.program_review_id = p.id)
  from public.program_reviews p
  join public.lea_reviews r on r.id = p.lea_review_id
  join public.review_cycles cy on cy.id = r.cycle_id
  join public.leas l on l.id = r.lea_id
  join public.program_catalog c on c.code = p.program_code
  where app.authed() and p.status <> 'removed'
    and (p_school_year is null or cy.school_year_id = p_school_year)
    and (
      app.is_state_admin() or app.has_role('leadership')
      or (app.has_role('cluster_admin') and c.cluster_code in (select app.user_cluster_codes()))
      or app.assigned_to_program_review(p.id)
      or (app.in_lea(r.lea_id) and r.released_at is not null and (app.manages_lea(r.lea_id) or p.finalized_at is not null))
    );
$$;
create or replace function public.review_counts(p_school_year uuid default null)
returns table (lea_id uuid, lea_name text, program_code text, program_name text, cluster_code text, review_month integer, review_year integer, status text, released boolean, finalized boolean, level2 bigint, level1 bigint, na bigint, open_findings bigint, cleared_findings bigint, pip_status text, pip_due date)
language sql security invoker set search_path = '' as $$ select * from app.review_counts(p_school_year); $$;
grant execute on function app.review_counts(uuid), public.review_counts(uuid) to authenticated;

-- Findings by indicator, counts only, for leadership and staff.
create or replace function app.finding_counts(p_school_year uuid default null) returns table (qpi_code text, open_count bigint, cleared_count bigint)
language sql stable security definer set search_path = ''
as $$
  select f.qpi_code, count(*) filter (where f.status = 'open'), count(*) filter (where f.status = 'cleared')
  from public.findings f
  join public.program_review_sites st on st.id = f.site_id
  join public.program_reviews p on p.id = st.program_review_id
  join public.lea_reviews r on r.id = p.lea_review_id
  join public.review_cycles cy on cy.id = r.cycle_id
  join public.program_catalog c on c.code = p.program_code
  where app.authed() and (p_school_year is null or cy.school_year_id = p_school_year)
    and (app.is_state_admin() or app.has_role('leadership') or (app.has_role('cluster_admin') and c.cluster_code in (select app.user_cluster_codes())) or app.assigned_to_program_review(p.id))
  group by f.qpi_code order by f.qpi_code;
$$;
create or replace function public.finding_counts(p_school_year uuid default null) returns table (qpi_code text, open_count bigint, cleared_count bigint) language sql security invoker set search_path = '' as $$ select * from app.finding_counts(p_school_year); $$;
grant execute on function app.finding_counts(uuid), public.finding_counts(uuid) to authenticated;

-- Scope changes become readable by the district after release (the change notices concern them).
create policy scope_changes_district_read on public.scope_changes for select to authenticated using (app.authed() and app.lea_review_released(lea_review_id) and app.in_lea(app.lea_review_lea(lea_review_id)));
