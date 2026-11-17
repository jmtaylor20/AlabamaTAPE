-- 0005: review cycles. Compliance list, declarations with the one-time review
-- window, selection (nominations plus a seeded random draw), scheduling,
-- milestones, assignments, and the embargo with its release.

-- Corrected guard for the instrument tables (0004 shipped a version that failed on tables without qpi_id).
create or replace function app.guard_instrument_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v uuid; rowj jsonb := to_jsonb(coalesce(new, old));
begin
  if tg_table_name = 'instrument_versions' then
    -- Status may move draft -> published -> retired; nothing else changes once published.
    if tg_op = 'UPDATE' and old.status <> 'draft' and (new.school_year_id, new.level, new.label) is distinct from (old.school_year_id, old.level, old.label) then
      raise exception 'published instrument versions cannot be edited' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.status = 'published' and new.status = 'draft' then
      raise exception 'a published instrument cannot return to draft' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_table_name = 'qpi_subitems' then
    select q.version_id into v from public.qpis q where q.id = (rowj ->> 'qpi_id')::uuid;
  else
    v := (rowj ->> 'version_id')::uuid;
  end if;
  if app.instrument_locked(v) then
    raise exception 'this instrument version is published and cannot be edited' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create type app.lea_review_status as enum ('listed', 'selected', 'scheduled', 'checked_in', 'released', 'evidence_due', 'desk_audit', 'onsite', 'post_visit', 'concluded');
create type app.program_review_status as enum ('selected', 'released', 'evidence_submitted', 'desk_audit', 'onsite', 'post_visit', 'finalized', 'concluded', 'removed');

alter table public.leas add column source text not null default 'manual';
alter table public.leas add column code_is_placeholder boolean not null default false;

create table public.lea_contacts (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  contact_role text not null default 'cte_director' check (contact_role in ('cte_director', 'alternate', 'superintendent', 'other')),
  display_name text not null,
  email text check (email is null or email = lower(email)),
  phone text,
  source text not null default 'manual',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index lea_contacts_lea on public.lea_contacts (lea_id);

create table public.review_cycles (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null unique references public.school_years (id),
  name text not null,
  selection_strategy text not null default 'nominate_then_random',
  target_percent numeric not null default 25 check (target_percent > 0 and target_percent <= 100),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.compliance_list (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.review_cycles (id),
  lea_id uuid not null references public.leas (id),
  review_month integer not null check (review_month between 1 and 12),
  review_year integer not null,
  compliance_week_start date,
  compliance_week_end date,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (cycle_id, lea_id)
);

-- ---------------------------------------------------------------------------
-- Declarations
-- ---------------------------------------------------------------------------
create table public.declaration_imports (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  school_year_id uuid not null references public.school_years (id),
  file_name text not null,
  row_count integer not null default 0,
  validation jsonb not null default '{}'::jsonb,
  status text not null default 'applied' check (status in ('previewed', 'applied', 'rejected')),
  imported_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.declared_programs (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  school_year_id uuid not null references public.school_years (id),
  home_school_id uuid references public.schools (id),
  location_lea_id uuid references public.leas (id),
  location_school_id uuid references public.schools (id),
  program_code text not null references public.program_catalog (code),
  delivery_type text not null default 'LOCAL' check (delivery_type in ('LOCAL', 'DUAL', 'ACCESS')),
  dual_scenario integer check (dual_scenario between 1 and 5),
  ase_accredited boolean not null default false,
  vacant boolean not null default false,
  first_year_teacher boolean not null default false,
  epic_requested boolean not null default false,
  excluded_reason text,
  status text not null default 'active' check (status in ('active', 'removed')),
  import_id uuid references public.declaration_imports (id),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index declared_programs_unique on public.declared_programs (lea_id, school_year_id, coalesce(home_school_id, '00000000-0000-0000-0000-000000000000'::uuid), program_code);
create index declared_programs_lea_year on public.declared_programs (lea_id, school_year_id);

create table public.declared_program_teachers (
  declared_program_id uuid not null references public.declared_programs (id) on delete cascade,
  teacher_id uuid not null references public.teachers (id),
  primary key (declared_program_id, teacher_id)
);

-- The one-time review window: outside it, declarations are read-only for the LEA.
create table public.declaration_windows (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  school_year_id uuid not null references public.school_years (id),
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  opened_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  closed_early_at timestamptz,
  closed_by uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);
create index declaration_windows_lea_year on public.declaration_windows (lea_id, school_year_id);

create table public.declaration_revisions (
  id bigint generated always as identity primary key,
  lea_id uuid not null references public.leas (id),
  school_year_id uuid not null references public.school_years (id),
  declared_program_id uuid,
  window_id uuid references public.declaration_windows (id),
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);
create index declaration_revisions_lea on public.declaration_revisions (lea_id, school_year_id, occurred_at desc);
create trigger declaration_revisions_immutable before update or delete on public.declaration_revisions for each row execute function app.reject_change();

-- ---------------------------------------------------------------------------
-- LEA reviews, milestones, selection, scheduling
-- ---------------------------------------------------------------------------
create table public.lea_reviews (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.review_cycles (id),
  lea_id uuid not null references public.leas (id),
  status app.lea_review_status not null default 'listed',
  is_carryover boolean not null default false,
  review_month integer not null check (review_month between 1 and 12),
  review_year integer not null,
  target_override integer check (target_override is null or target_override >= 0),
  target_override_reason text,
  choice1_start date,
  choice1_end date,
  choice2_start date,
  choice2_end date,
  visit_start date,
  visit_end date,
  released_at timestamptz,
  released_by uuid references public.profiles (id),
  checked_in_at timestamptz,
  concluded_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, lea_id),
  check (visit_end is null or visit_start is null or visit_end >= visit_start)
);
create index lea_reviews_lea on public.lea_reviews (lea_id);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  lea_review_id uuid not null references public.lea_reviews (id) on delete cascade,
  kind text not null check (kind in ('check_in', 'notification', 'evidence_due', 'visit_start', 'visit_end', 'ten_day_close', 'pip_start', 'pip_due')),
  computed_on date,
  override_on date,
  override_reason text,
  completed_at timestamptz,
  unique (lea_review_id, kind)
);

create or replace function app.milestone_date(p_lea_review uuid, p_kind text) returns date
language sql stable security definer set search_path = ''
as $$ select coalesce(m.override_on, m.computed_on) from public.milestones m where m.lea_review_id = p_lea_review and m.kind = p_kind; $$;

create table public.selection_draws (
  id uuid primary key default gen_random_uuid(),
  lea_review_id uuid not null references public.lea_reviews (id),
  strategy text not null,
  seed text not null,
  target_count integer not null,
  pool jsonb not null,
  excluded jsonb not null,
  result jsonb not null,
  ran_by uuid references public.profiles (id),
  ran_at timestamptz not null default now()
);
create trigger selection_draws_immutable before update or delete on public.selection_draws for each row execute function app.reject_change();

create table public.selections (
  id uuid primary key default gen_random_uuid(),
  lea_review_id uuid not null references public.lea_reviews (id),
  declared_program_id uuid not null references public.declared_programs (id),
  method text not null check (method in ('nominated', 'random', 'manual', 'carryover', 'imported')),
  nominated_by uuid references public.profiles (id),
  nomination_reason text,
  draw_id uuid references public.selection_draws (id),
  status text not null default 'active' check (status in ('active', 'removed')),
  removal_reason text,
  removed_by uuid references public.profiles (id),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lea_review_id, declared_program_id)
);

create table public.program_reviews (
  id uuid primary key default gen_random_uuid(),
  lea_review_id uuid not null references public.lea_reviews (id),
  selection_id uuid references public.selections (id),
  program_code text not null references public.program_catalog (code),
  instrument_version_id uuid references public.instrument_versions (id),
  epic boolean not null default false,
  status app.program_review_status not null default 'selected',
  visit_date date,
  sequence integer,
  pip_expected boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lea_review_id, program_code)
);
create index program_reviews_lea_review on public.program_reviews (lea_review_id);

create table public.program_review_sites (
  id uuid primary key default gen_random_uuid(),
  program_review_id uuid not null references public.program_reviews (id) on delete cascade,
  school_id uuid references public.schools (id),
  school_name text,
  visit_at timestamptz,
  created_at timestamptz not null default now()
);
create index program_review_sites_review on public.program_review_sites (program_review_id);

create table public.program_review_site_teachers (
  site_id uuid not null references public.program_review_sites (id) on delete cascade,
  teacher_id uuid not null references public.teachers (id),
  primary key (site_id, teacher_id)
);

-- Assignments may be made by email before the person has an account; the
-- profile trigger links them on first sign-in.
create table public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  program_review_id uuid not null references public.program_reviews (id) on delete cascade,
  user_id uuid references public.profiles (id),
  email text not null check (email = lower(email)),
  display_name text,
  assignment_role text not null check (assignment_role in ('lead_reviewer', 'reviewer', 'cluster_admin')),
  sort integer not null default 1,
  assigned_by uuid references public.profiles (id),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now()
);
create index review_assignments_review on public.review_assignments (program_review_id);
create index review_assignments_user on public.review_assignments (user_id);
create index review_assignments_email on public.review_assignments (email);

create table public.scope_changes (
  id uuid primary key default gen_random_uuid(),
  lea_review_id uuid not null references public.lea_reviews (id),
  kind text not null check (kind in ('program_added', 'program_removed', 'reviewer_added', 'reviewer_removed', 'date_changed', 'target_changed', 'reopened')),
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  inform jsonb not null default '[]'::jsonb,
  actor_id uuid references public.profiles (id),
  occurred_at timestamptz not null default now()
);
create trigger scope_changes_immutable before update or delete on public.scope_changes for each row execute function app.reject_change();

-- ---------------------------------------------------------------------------
-- Audit and revision triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['lea_contacts', 'review_cycles', 'compliance_list', 'declaration_imports', 'declared_programs', 'declared_program_teachers', 'declaration_windows', 'lea_reviews', 'milestones', 'selections', 'program_reviews', 'program_review_sites', 'program_review_site_teachers', 'review_assignments']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

create or replace function app.record_declaration_revision() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare row_ jsonb := to_jsonb(coalesce(new, old)); w uuid; dp public.declared_programs%rowtype;
begin
  if tg_table_name = 'declared_program_teachers' then
    select * into dp from public.declared_programs d where d.id = coalesce(new.declared_program_id, old.declared_program_id);
  else
    dp := coalesce(new, old);
  end if;
  select id into w from public.declaration_windows x where x.lea_id = dp.lea_id and x.school_year_id = dp.school_year_id and x.opens_at <= now() and x.closes_at > now() and x.closed_early_at is null order by x.opens_at desc limit 1;
  insert into public.declaration_revisions (lea_id, school_year_id, declared_program_id, window_id, action, before, after, actor_id)
  values (dp.lea_id, dp.school_year_id, dp.id, w, tg_table_name || '.' || lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end, auth.uid());
  if tg_table_name = 'declared_programs' and tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end;
$$;
create trigger declared_programs_revision before insert or update or delete on public.declared_programs for each row execute function app.record_declaration_revision();
create trigger declared_program_teachers_revision after insert or delete on public.declared_program_teachers for each row execute function app.record_declaration_revision();

-- Link assignments made by email when the person's profile appears.
create or replace function app.link_assignments_to_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.review_assignments set user_id = new.id where email = new.email and user_id is null;
  return new;
end;
$$;
create trigger profiles_link_assignments after insert on public.profiles for each row execute function app.link_assignments_to_profile();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create or replace function app.lea_review_released(p_lea_review uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.lea_reviews r where r.id = p_lea_review and r.released_at is not null); $$;

create or replace function app.lea_review_lea(p_lea_review uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select r.lea_id from public.lea_reviews r where r.id = p_lea_review; $$;

create or replace function app.assigned_to_program_review(p_program_review uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.review_assignments a where a.program_review_id = p_program_review and a.user_id = auth.uid() and a.revoked_at is null);
$$;

create or replace function app.assigned_in_lea_review(p_lea_review uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.review_assignments a join public.program_reviews p on p.id = a.program_review_id
    where p.lea_review_id = p_lea_review and a.user_id = auth.uid() and a.revoked_at is null
  );
$$;

create or replace function app.cluster_admin_for_program(p_program_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.program_catalog c where c.code = p_program_code and c.cluster_code in (select app.user_cluster_codes())
  );
$$;

-- Who may see a program review in full.
create or replace function app.can_see_program_review(p_program_review uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.program_reviews p
    where p.id = p_program_review and (
      app.is_state_admin()
      or app.has_role('leadership')
      or app.assigned_to_program_review(p.id)
      or (app.has_role('cluster_admin') and app.cluster_admin_for_program(p.program_code))
      or (app.in_lea(app.lea_review_lea(p.lea_review_id)) and app.lea_review_released(p.lea_review_id))
    )
  );
$$;

create or replace function app.declaration_window_open(p_lea uuid, p_year uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.declaration_windows w
    where w.lea_id = p_lea and w.school_year_id = p_year and w.opens_at <= now() and w.closes_at > now() and w.closed_early_at is null and w.confirmed_at is null
  );
$$;

create or replace function app.teacher_on_declared_program(p_declared_program uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.declared_program_teachers t where t.declared_program_id = p_declared_program and t.teacher_id = app.my_teacher_id());
$$;

grant execute on function app.lea_review_released(uuid), app.lea_review_lea(uuid), app.assigned_to_program_review(uuid), app.assigned_in_lea_review(uuid),
  app.cluster_admin_for_program(text), app.can_see_program_review(uuid), app.declaration_window_open(uuid, uuid), app.teacher_on_declared_program(uuid), app.milestone_date(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Eligibility, milestones, selection draw, release
-- ---------------------------------------------------------------------------
create or replace function app.declared_program_eligible(p_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.declared_programs d join public.program_catalog c on c.code = d.program_code
    where d.id = p_id and d.status = 'active' and c.active and d.excluded_reason is null and not d.vacant and not d.first_year_teacher
      and (d.location_lea_id is null or d.location_lea_id = d.lea_id)
      and (d.delivery_type = 'LOCAL' or (d.delivery_type = 'DUAL' and d.dual_scenario in (1, 2, 3)))
  );
$$;

create or replace function app.is_holiday(p_date date) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.holidays h where h.holiday_on = p_date); $$;

-- The 13th of the month before the review month (two months before for January),
-- moved to the prior Friday when it falls on a weekend or holiday.
create or replace function app.notification_date(p_review_month integer, p_review_year integer) returns date
language plpgsql stable security definer set search_path = ''
as $$
declare base date; d date; dow integer; guard integer := 0;
begin
  base := make_date(p_review_year, p_review_month, 1) - (case when p_review_month = 1 then interval '2 months' else interval '1 month' end);
  d := make_date(extract(year from base)::int, extract(month from base)::int, 13);
  loop
    dow := extract(dow from d)::int;
    if dow not in (0, 6) and not app.is_holiday(d) then return d; end if;
    d := d - (case when dow = 6 then 1 when dow = 0 then 2 when dow = 5 then 7 else (dow + 2) % 7 end);
    guard := guard + 1;
    if guard > 10 then return d; end if;
  end loop;
end;
$$;

create or replace function app.evidence_due_date(p_cycle uuid, p_review_month integer, p_review_year integer) returns date
language plpgsql stable security definer set search_path = ''
as $$
declare s jsonb; d date;
begin
  if p_review_month = 1 then
    select settings into s from public.review_cycles where id = p_cycle;
    if s ? 'january_evidence_due' then return (s ->> 'january_evidence_due')::date; end if;
    d := make_date(p_review_year, 1, 4);
    while extract(dow from d)::int in (0, 6) or app.is_holiday(d) loop d := d + 1; end loop;
    return d;
  end if;
  return make_date(p_review_year, p_review_month, 1);
end;
$$;

create or replace function app.compute_milestones(p_lea_review uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.lea_reviews%rowtype; checkin date; v_end date;
begin
  select * into r from public.lea_reviews where id = p_lea_review;
  if r.id is null then return; end if;
  checkin := make_date(extract(year from (make_date(r.review_year, r.review_month, 1) - interval '2 months'))::int, extract(month from (make_date(r.review_year, r.review_month, 1) - interval '2 months'))::int, 20);
  v_end := coalesce(r.visit_end, r.visit_start);
  insert into public.milestones (lea_review_id, kind, computed_on) values
    (p_lea_review, 'check_in', checkin),
    (p_lea_review, 'notification', app.notification_date(r.review_month, r.review_year)),
    (p_lea_review, 'evidence_due', app.evidence_due_date(r.cycle_id, r.review_month, r.review_year)),
    (p_lea_review, 'visit_start', r.visit_start),
    (p_lea_review, 'visit_end', v_end),
    (p_lea_review, 'ten_day_close', v_end + 10),
    (p_lea_review, 'pip_start', v_end + 11),
    (p_lea_review, 'pip_due', (v_end + 11) + interval '12 months')
  on conflict (lea_review_id, kind) do update set computed_on = excluded.computed_on;
end;
$$;

create or replace function app.lea_reviews_after_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.review_month, new.review_year, new.visit_start, new.visit_end) is distinct from (old.review_month, old.review_year, old.visit_start, old.visit_end) then
    perform app.compute_milestones(new.id);
  end if;
  return new;
end;
$$;
create trigger lea_reviews_milestones after insert or update on public.lea_reviews for each row execute function app.lea_reviews_after_change();

create or replace function app.lea_reviews_before_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  if old.released_at is not null and new.released_at is null then
    raise exception 'a release cannot be undone' using errcode = '42501';
  end if;
  if old.status = 'concluded' and new.status <> 'concluded' and not app.is_state_admin() then
    raise exception 'a concluded review can only be reopened by the State Admin' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger lea_reviews_guard before update on public.lea_reviews for each row execute function app.lea_reviews_before_update();

create or replace function app.selection_target(p_lea_review uuid) returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare r public.lea_reviews%rowtype; pct numeric; eligible integer;
begin
  select * into r from public.lea_reviews where id = p_lea_review;
  if r.target_override is not null then return r.target_override; end if;
  select target_percent into pct from public.review_cycles where id = r.cycle_id;
  select count(*) into eligible from public.declared_programs d
    join public.review_cycles c on c.id = r.cycle_id and c.school_year_id = d.school_year_id
    where d.lea_id = r.lea_id and app.declared_program_eligible(d.id);
  if eligible = 0 then return 0; end if;
  return greatest(1, ceil(eligible * pct / 100.0)::int);
end;
$$;

-- Fill the remaining slots at random. Deterministic for a given seed, so the
-- draw can be reproduced and audited.
create or replace function app.run_selection_draw(p_lea_review uuid, p_seed text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r public.lea_reviews%rowtype; v_target integer; v_have integer; v_need integer; v_pool jsonb; v_excluded jsonb; v_result jsonb; v_draw uuid; rec record; chosen uuid[] := '{}';
begin
  if not app.is_state_admin() then raise exception 'only the State Admin can run a draw' using errcode = '42501'; end if;
  select * into r from public.lea_reviews where id = p_lea_review;
  if r.id is null then raise exception 'review not found'; end if;
  if r.released_at is not null then raise exception 'selections are locked after release' using errcode = '42501'; end if;
  v_target := app.selection_target(p_lea_review);
  select count(*) into v_have from public.selections s where s.lea_review_id = p_lea_review and s.status = 'active';
  v_need := greatest(0, v_target - v_have);

  select coalesce(jsonb_agg(jsonb_build_object('declared_program_id', d.id, 'program_code', d.program_code, 'school_id', d.home_school_id) order by d.program_code), '[]'::jsonb)
    into v_pool
  from public.declared_programs d join public.review_cycles c on c.id = r.cycle_id and c.school_year_id = d.school_year_id
  where d.lea_id = r.lea_id and app.declared_program_eligible(d.id)
    and not exists (select 1 from public.selections s where s.lea_review_id = p_lea_review and s.declared_program_id = d.id);

  select coalesce(jsonb_agg(jsonb_build_object('declared_program_id', d.id, 'program_code', d.program_code, 'reason',
      case when d.status <> 'active' then 'removed' when d.excluded_reason is not null then d.excluded_reason when d.vacant then 'vacant' when d.first_year_teacher then 'first-year teacher'
           when d.location_lea_id is not null and d.location_lea_id <> d.lea_id then 'taught at another LEA' when d.delivery_type = 'ACCESS' then 'ACCESS' when d.delivery_type = 'DUAL' then 'dual enrollment scenario ' || coalesce(d.dual_scenario::text, 'unknown') else 'ineligible' end)), '[]'::jsonb)
    into v_excluded
  from public.declared_programs d join public.review_cycles c on c.id = r.cycle_id and c.school_year_id = d.school_year_id
  where d.lea_id = r.lea_id and not app.declared_program_eligible(d.id);

  for rec in
    select d.id from public.declared_programs d join public.review_cycles c on c.id = r.cycle_id and c.school_year_id = d.school_year_id
    where d.lea_id = r.lea_id and app.declared_program_eligible(d.id)
      and not exists (select 1 from public.selections s where s.lea_review_id = p_lea_review and s.declared_program_id = d.id)
    order by md5(p_seed || d.id::text)
    limit v_need
  loop
    chosen := chosen || rec.id;
  end loop;

  v_result := jsonb_build_object('target', v_target, 'already_selected', v_have, 'drawn', to_jsonb(chosen));
  insert into public.selection_draws (lea_review_id, strategy, seed, target_count, pool, excluded, result, ran_by)
  values (p_lea_review, 'nominate_then_random', p_seed, v_target, v_pool, v_excluded, v_result, auth.uid()) returning id into v_draw;

  insert into public.selections (lea_review_id, declared_program_id, method, draw_id)
  select p_lea_review, unnest(chosen), 'random', v_draw;

  insert into public.program_reviews (lea_review_id, selection_id, program_code)
  select s.lea_review_id, s.id, d.program_code from public.selections s join public.declared_programs d on d.id = s.declared_program_id
  where s.lea_review_id = p_lea_review and s.status = 'active'
  on conflict (lea_review_id, program_code) do nothing;

  update public.lea_reviews set status = 'selected' where id = p_lea_review and status = 'listed';
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'selection.draw', 'lea_reviews', p_lea_review::text, r.lea_id, jsonb_build_object('draw_id', v_draw, 'seed', p_seed, 'target', v_target, 'drawn', array_length(chosen, 1)));
  return v_draw;
end;
$$;

-- Every active selection gets a program review and sites for each school where the program is declared.
create or replace function app.materialize_program_reviews(p_lea_review uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.lea_reviews%rowtype; v_version uuid; rec record;
begin
  select * into r from public.lea_reviews where id = p_lea_review;
  select v.id into v_version from public.instrument_versions v join public.review_cycles c on c.school_year_id = v.school_year_id
    where c.id = r.cycle_id and v.status = 'published' order by v.published_at desc limit 1;
  insert into public.program_reviews (lea_review_id, selection_id, program_code, instrument_version_id, epic)
  select s.lea_review_id, s.id, d.program_code, v_version, d.epic_requested
  from public.selections s join public.declared_programs d on d.id = s.declared_program_id
  where s.lea_review_id = p_lea_review and s.status = 'active'
  on conflict (lea_review_id, program_code) do update set instrument_version_id = coalesce(public.program_reviews.instrument_version_id, excluded.instrument_version_id);
  for rec in
    select p.id as program_review_id, d.id as declared_program_id, d.home_school_id, sc.name as school_name
    from public.program_reviews p
    join public.declared_programs d on d.lea_id = r.lea_id and d.program_code = p.program_code and d.status = 'active'
    join public.review_cycles c on c.id = r.cycle_id and c.school_year_id = d.school_year_id
    left join public.schools sc on sc.id = d.home_school_id
    where p.lea_review_id = p_lea_review and p.status <> 'removed'
  loop
    if not exists (select 1 from public.program_review_sites s where s.program_review_id = rec.program_review_id and s.school_id is not distinct from rec.home_school_id) then
      insert into public.program_review_sites (program_review_id, school_id, school_name) values (rec.program_review_id, rec.home_school_id, rec.school_name);
    end if;
    insert into public.program_review_site_teachers (site_id, teacher_id)
    select s.id, t.teacher_id from public.program_review_sites s join public.declared_program_teachers t on t.declared_program_id = rec.declared_program_id
    where s.program_review_id = rec.program_review_id and s.school_id is not distinct from rec.home_school_id
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function app.release_notification(p_lea_review uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.lea_reviews%rowtype; n integer;
begin
  if not app.is_state_admin() then raise exception 'only the State Admin can release a notification' using errcode = '42501'; end if;
  select * into r from public.lea_reviews where id = p_lea_review;
  if r.id is null then raise exception 'review not found'; end if;
  if r.released_at is not null then raise exception 'already released'; end if;
  if r.visit_start is null then raise exception 'set the review date before releasing'; end if;
  select count(*) into n from public.program_reviews p where p.lea_review_id = p_lea_review and p.status <> 'removed';
  if n = 0 then raise exception 'select at least one program before releasing'; end if;
  if exists (select 1 from public.program_reviews p where p.lea_review_id = p_lea_review and p.status <> 'removed'
             and not exists (select 1 from public.review_assignments a where a.program_review_id = p.id and a.revoked_at is null and a.assignment_role in ('lead_reviewer', 'reviewer'))) then
    raise exception 'every program needs a reviewer before releasing';
  end if;
  perform app.materialize_program_reviews(p_lea_review);
  update public.lea_reviews set released_at = now(), released_by = auth.uid(), status = 'released' where id = p_lea_review;
  update public.program_reviews set status = 'released' where lea_review_id = p_lea_review and status = 'selected';
  update public.milestones set completed_at = now() where lea_review_id = p_lea_review and kind = 'notification';
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'lea_review.released', 'lea_reviews', p_lea_review::text, r.lea_id, jsonb_build_object('programs', n, 'visit_start', r.visit_start, 'visit_end', r.visit_end));
end;
$$;

-- What a district account may learn before release: that it is on the list, the month, and when details arrive.
create or replace function app.my_lea_review_summary() returns table (lea_review_id uuid, lea_id uuid, review_month integer, review_year integer, notification_on date, released boolean, status text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.lea_id, r.review_month, r.review_year, app.milestone_date(r.id, 'notification'), r.released_at is not null,
         case when r.released_at is not null then r.status::text else 'listed' end
  from public.lea_reviews r where app.authed() and app.in_lea(r.lea_id);
$$;

grant execute on function app.run_selection_draw(uuid, text), app.release_notification(uuid), app.compute_milestones(uuid), app.materialize_program_reviews(uuid), app.selection_target(uuid),
  app.declared_program_eligible(uuid), app.notification_date(integer, integer), app.evidence_due_date(uuid, integer, integer), app.my_lea_review_summary() to authenticated;

create or replace function public.run_selection_draw(p_lea_review uuid, p_seed text) returns uuid language sql security invoker set search_path = '' as $$ select app.run_selection_draw(p_lea_review, p_seed); $$;
create or replace function public.release_notification(p_lea_review uuid) returns void language sql security invoker set search_path = '' as $$ select app.release_notification(p_lea_review); $$;
create or replace function public.materialize_program_reviews(p_lea_review uuid) returns void language sql security invoker set search_path = '' as $$ select app.materialize_program_reviews(p_lea_review); $$;
create or replace function public.compute_milestones(p_lea_review uuid) returns void language sql security invoker set search_path = '' as $$ select app.compute_milestones(p_lea_review); $$;
create or replace function public.selection_target(p_lea_review uuid) returns integer language sql security invoker set search_path = '' as $$ select app.selection_target(p_lea_review); $$;
create or replace function public.my_lea_review_summary() returns table (lea_review_id uuid, lea_id uuid, review_month integer, review_year integer, notification_on date, released boolean, status text) language sql security invoker set search_path = '' as $$ select * from app.my_lea_review_summary(); $$;
create or replace function public.declared_program_eligible(p_id uuid) returns boolean language sql security invoker set search_path = '' as $$ select app.declared_program_eligible(p_id); $$;
grant execute on function public.run_selection_draw(uuid, text), public.release_notification(uuid), public.materialize_program_reviews(uuid), public.compute_milestones(uuid), public.selection_target(uuid), public.my_lea_review_summary(), public.declared_program_eligible(uuid) to authenticated;

-- A single changes log over everything that matters to a cycle.
create or replace view public.change_log with (security_invoker = true) as
  select e.id, e.occurred_at, e.actor_id, e.action, e.entity_type, e.entity_id, e.lea_id, e.before, e.after, e.meta
  from public.audit_events e
  where e.entity_type in ('declared_programs', 'declared_program_teachers', 'selections', 'lea_reviews', 'program_reviews', 'review_assignments', 'lea_contacts', 'milestones', 'compliance_list')
     or e.action in ('selection.draw', 'lea_review.released');
grant select on public.change_log to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.lea_contacts enable row level security;
alter table public.review_cycles enable row level security;
alter table public.compliance_list enable row level security;
alter table public.declaration_imports enable row level security;
alter table public.declared_programs enable row level security;
alter table public.declared_program_teachers enable row level security;
alter table public.declaration_windows enable row level security;
alter table public.declaration_revisions enable row level security;
alter table public.lea_reviews enable row level security;
alter table public.milestones enable row level security;
alter table public.selection_draws enable row level security;
alter table public.selections enable row level security;
alter table public.program_reviews enable row level security;
alter table public.program_review_sites enable row level security;
alter table public.program_review_site_teachers enable row level security;
alter table public.review_assignments enable row level security;
alter table public.scope_changes enable row level security;

grant select, insert, update on public.lea_contacts, public.review_cycles, public.compliance_list, public.declaration_imports, public.declared_programs,
  public.declaration_windows, public.lea_reviews, public.milestones, public.selections, public.program_reviews, public.program_review_sites, public.review_assignments to authenticated;
grant select, insert, delete on public.declared_program_teachers, public.program_review_site_teachers to authenticated;
grant select, insert on public.scope_changes to authenticated;
grant select on public.declaration_revisions, public.selection_draws to authenticated;

create policy lea_contacts_read on public.lea_contacts for select to authenticated using (app.authed() and (app.is_staff() or app.manages_lea(lea_id)));
create policy lea_contacts_write on public.lea_contacts for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy review_cycles_read on public.review_cycles for select to authenticated using (app.authed());
create policy review_cycles_write on public.review_cycles for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy compliance_list_read on public.compliance_list for select to authenticated using (app.authed() and (app.is_staff() or app.in_lea(lea_id)));
create policy compliance_list_write on public.compliance_list for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy declaration_imports_admin on public.declaration_imports for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy declaration_imports_lea_read on public.declaration_imports for select to authenticated using (app.authed() and app.manages_lea(lea_id));

create policy declared_programs_read on public.declared_programs for select to authenticated using (
  app.authed() and (app.is_staff() or app.manages_lea(lea_id) or app.teacher_on_declared_program(id))
);
create policy declared_programs_admin on public.declared_programs for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy declared_programs_lea_insert on public.declared_programs for insert to authenticated with check (app.authed() and app.manages_lea(lea_id) and app.declaration_window_open(lea_id, school_year_id));
create policy declared_programs_lea_update on public.declared_programs for update to authenticated
  using (app.authed() and app.manages_lea(lea_id) and app.declaration_window_open(lea_id, school_year_id))
  with check (app.authed() and app.manages_lea(lea_id) and app.declaration_window_open(lea_id, school_year_id));

create policy declared_program_teachers_read on public.declared_program_teachers for select to authenticated using (
  app.authed() and exists (select 1 from public.declared_programs d where d.id = declared_program_teachers.declared_program_id and (app.is_staff() or app.manages_lea(d.lea_id) or app.teacher_on_declared_program(d.id)))
);
create policy declared_program_teachers_admin on public.declared_program_teachers for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy declared_program_teachers_lea on public.declared_program_teachers for all to authenticated
  using (app.authed() and exists (select 1 from public.declared_programs d where d.id = declared_program_teachers.declared_program_id and app.manages_lea(d.lea_id) and app.declaration_window_open(d.lea_id, d.school_year_id)))
  with check (app.authed() and exists (select 1 from public.declared_programs d where d.id = declared_program_teachers.declared_program_id and app.manages_lea(d.lea_id) and app.declaration_window_open(d.lea_id, d.school_year_id)));

create policy declaration_windows_admin on public.declaration_windows for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy declaration_windows_lea_read on public.declaration_windows for select to authenticated using (app.authed() and app.manages_lea(lea_id));
create policy declaration_windows_lea_confirm on public.declaration_windows for update to authenticated
  using (app.authed() and app.directs_lea(lea_id) and confirmed_at is null and closed_early_at is null and closes_at > now())
  with check (app.authed() and app.directs_lea(lea_id) and confirmed_by = auth.uid());

create policy declaration_revisions_read on public.declaration_revisions for select to authenticated using (app.authed() and (app.is_staff() or app.manages_lea(lea_id)));

-- The embargo: district roles see an LEA review only after release.
create policy lea_reviews_staff_read on public.lea_reviews for select to authenticated using (app.authed() and app.is_staff());
create policy lea_reviews_district_read on public.lea_reviews for select to authenticated using (app.authed() and app.in_lea(lea_id) and released_at is not null);
create policy lea_reviews_admin on public.lea_reviews for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy lea_reviews_reviewer_dates on public.lea_reviews for update to authenticated
  using (app.authed() and app.has_role('reviewer') and released_at is null) with check (app.authed() and app.has_role('reviewer') and released_at is null);

create policy milestones_staff_read on public.milestones for select to authenticated using (app.authed() and app.is_staff());
create policy milestones_district_read on public.milestones for select to authenticated using (app.authed() and app.lea_review_released(lea_review_id) and app.in_lea(app.lea_review_lea(lea_review_id)));
create policy milestones_admin on public.milestones for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy selection_draws_read on public.selection_draws for select to authenticated using (app.authed() and app.is_staff());

create policy selections_staff_read on public.selections for select to authenticated using (app.authed() and app.is_staff());
create policy selections_district_read on public.selections for select to authenticated using (app.authed() and app.lea_review_released(lea_review_id) and app.in_lea(app.lea_review_lea(lea_review_id)) and status = 'active');
create policy selections_admin on public.selections for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy selections_nominate on public.selections for insert to authenticated with check (
  app.authed() and (app.has_role('reviewer') or app.has_role('cluster_admin')) and method = 'nominated' and nominated_by = auth.uid()
  and not app.lea_review_released(lea_review_id) and app.declared_program_eligible(declared_program_id)
  and exists (select 1 from public.declared_programs d where d.id = declared_program_id and d.lea_id = app.lea_review_lea(lea_review_id))
);

create policy program_reviews_read on public.program_reviews for select to authenticated using (app.authed() and app.can_see_program_review(id));
create policy program_reviews_admin on public.program_reviews for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy program_reviews_assigned_update on public.program_reviews for update to authenticated
  using (app.authed() and app.assigned_to_program_review(id)) with check (app.authed() and app.assigned_to_program_review(id));

create policy program_review_sites_read on public.program_review_sites for select to authenticated using (app.authed() and app.can_see_program_review(program_review_id));
create policy program_review_sites_admin on public.program_review_sites for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy program_review_sites_assigned on public.program_review_sites for update to authenticated using (app.authed() and app.assigned_to_program_review(program_review_id)) with check (app.authed() and app.assigned_to_program_review(program_review_id));

create policy program_review_site_teachers_read on public.program_review_site_teachers for select to authenticated using (
  app.authed() and exists (select 1 from public.program_review_sites s where s.id = program_review_site_teachers.site_id and app.can_see_program_review(s.program_review_id))
);
create policy program_review_site_teachers_admin on public.program_review_site_teachers for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy review_assignments_read on public.review_assignments for select to authenticated using (
  app.authed() and (app.is_state_admin() or user_id = auth.uid() or email = (select p.email from public.profiles p where p.id = auth.uid()) or app.can_see_program_review(program_review_id))
);
create policy review_assignments_admin on public.review_assignments for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

create policy scope_changes_read on public.scope_changes for select to authenticated using (app.authed() and app.is_staff());
create policy scope_changes_insert on public.scope_changes for insert to authenticated with check (app.authed() and app.is_state_admin() and actor_id = auth.uid());
