-- 0002: foundation. People, access, reference records, and the audit log.
-- Every table has row-level security. Nothing is readable without a policy,
-- a signed-in session that passed MFA, and an active profile.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create type app.role as enum (
  'state_admin', 'cluster_admin', 'reviewer', 'cte_director', 'lea_staff', 'teacher', 'leadership', 'developer'
);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (label ~ '^\d{4}-\d{4}$'),
  starts_on date not null,
  ends_on date not null check (ends_on > starts_on),
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index school_years_one_current on public.school_years (is_current) where is_current;

create table public.clusters (
  code text primary key check (code ~ '^\d{2}$'),
  name text not null unique,
  sort integer not null default 0
);

create table public.program_catalog (
  code text primary key check (code ~ '^\d{1,3}$'),
  name text not null,
  cluster_code text not null references public.clusters (code),
  level text not null default 'secondary' check (level in ('secondary', 'middle')),
  is_coop boolean not null default false,
  active boolean not null default true
);

create table public.leas (
  id uuid primary key default gen_random_uuid(),
  system_code text not null unique check (system_code ~ '^\d{3}$'),
  name text not null,
  lea_type text not null default 'county' check (lea_type in ('county', 'city', 'charter', 'college', 'other')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  school_code text not null check (school_code ~ '^\d{4}$'),
  name text not null,
  school_type text not null default 'high_school' check (school_type in ('high_school', 'middle_school', 'career_tech_center', 'college', 'other')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lea_id, school_code)
);

-- Email domains allowed for invitations. lea_id null means an ALSDE staff domain.
create table public.approved_domains (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid references public.leas (id),
  domain text not null check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  created_at timestamptz not null default now()
);
create unique index approved_domains_unique on public.approved_domains (domain, coalesce(lea_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_on date not null,
  name text not null,
  scope text not null default 'state' check (scope in ('state', 'federal')),
  unique (holiday_on, name)
);

-- ---------------------------------------------------------------------------
-- People and access
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(email)),
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'deactivated')),
  deactivated_at timestamptz,
  deactivated_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  role app.role not null,
  lea_id uuid references public.leas (id),
  cluster_code text references public.clusters (code),
  granted_by uuid references public.profiles (id),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint role_scope check (
    (role in ('cte_director', 'lea_staff', 'teacher') and lea_id is not null and cluster_code is null) or
    (role = 'cluster_admin' and cluster_code is not null and lea_id is null) or
    (role in ('state_admin', 'reviewer', 'leadership', 'developer') and lea_id is null and cluster_code is null)
  )
);
create index role_grants_user on public.role_grants (user_id);
create index role_grants_lea on public.role_grants (lea_id);

create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  lea_id uuid not null references public.leas (id),
  display_name text not null,
  email text check (email is null or email = lower(email)),
  alsde_teacher_id text,
  profile_id uuid references public.profiles (id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);
create index teachers_lea on public.teachers (lea_id);
create unique index teachers_profile on public.teachers (profile_id) where profile_id is not null;

create table public.teacher_years (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id),
  school_year_id uuid not null references public.school_years (id),
  contract_type text not null default 'nine_month' check (contract_type in ('nine_month', 'extended')),
  first_year boolean not null default false,
  unique (teacher_id, school_year_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  display_name text,
  role app.role not null,
  lea_id uuid references public.leas (id),
  cluster_code text references public.clusters (code),
  teacher_id uuid references public.teachers (id),
  invited_by uuid references public.profiles (id),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_user_id uuid references public.profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint invitation_scope check (
    (role in ('cte_director', 'lea_staff', 'teacher') and lea_id is not null and cluster_code is null) or
    (role = 'cluster_admin' and cluster_code is not null and lea_id is null) or
    (role in ('state_admin', 'reviewer', 'leadership', 'developer') and lea_id is null and cluster_code is null)
  )
);
create index invitations_email on public.invitations (email);

-- "Wherever person A is included, include person B."
create table public.staff_pairings (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references public.profiles (id),
  person_b uuid not null references public.profiles (id),
  reason text not null,
  starts_on date not null default current_date,
  ends_on date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (person_a <> person_b)
);

-- ---------------------------------------------------------------------------
-- Audit log: append only. No role, including the service role, can change a row.
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  lea_id uuid,
  before jsonb,
  after jsonb,
  meta jsonb,
  ip inet,
  user_agent text
);
create index audit_events_entity on public.audit_events (entity_type, entity_id);
create index audit_events_actor on public.audit_events (actor_id, occurred_at desc);
create index audit_events_lea on public.audit_events (lea_id, occurred_at desc);

create or replace function app.reject_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events rows cannot be modified or deleted' using errcode = '42501';
end;
$$;
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function app.reject_change();

-- Row-change audit trigger. Attached to every table whose changes matter.
create or replace function app.audit_row_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_after jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_after, v_before);
begin
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, before, after)
  values (
    auth.uid(),
    auth.role(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    nullif(v_row ->> 'lea_id', '')::uuid,
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;

-- Application-level events (sign-in, file view, export, release). Callable by any
-- signed-in user, but only records the caller as the actor.
create or replace function app.log_event(p_action text, p_entity_type text, p_entity_id text default null, p_lea_id uuid default null, p_meta jsonb default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), p_action, p_entity_type, p_entity_id, p_lea_id, p_meta)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function app.log_event(text, text, text, uuid, jsonb) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['leas', 'schools', 'approved_domains', 'holidays', 'profiles', 'role_grants', 'teachers', 'teacher_years', 'invitations', 'staff_pairings', 'school_years', 'program_catalog']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Access helpers. Security definer so they can read profiles and role_grants
-- without recursing through those tables' own policies.
-- ---------------------------------------------------------------------------
create or replace function app.profile_active() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

-- The gate every policy starts with: signed in, passed MFA, profile active.
create or replace function app.authed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_mfa() and app.profile_active();
$$;

create or replace function app.has_role(p_role app.role) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.role_grants g
    where g.user_id = auth.uid() and g.role = p_role and g.revoked_at is null
      and g.valid_from <= now() and (g.valid_to is null or g.valid_to > now())
  );
$$;

create or replace function app.is_state_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select app.has_role('state_admin'); $$;

-- ALSDE roles that may see records statewide.
create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role('state_admin') or app.has_role('cluster_admin') or app.has_role('reviewer') or app.has_role('leadership');
$$;

create or replace function app.user_lea_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select g.lea_id from public.role_grants g
  where g.user_id = auth.uid() and g.lea_id is not null and g.revoked_at is null
    and g.valid_from <= now() and (g.valid_to is null or g.valid_to > now());
$$;

create or replace function app.in_lea(p_lea uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_lea in (select app.user_lea_ids()); $$;

-- District roles that manage LEA records (Director and LEA staff, not teachers).
create or replace function app.manages_lea(p_lea uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.role_grants g
    where g.user_id = auth.uid() and g.lea_id = p_lea and g.role in ('cte_director', 'lea_staff')
      and g.revoked_at is null and g.valid_from <= now() and (g.valid_to is null or g.valid_to > now())
  );
$$;

create or replace function app.directs_lea(p_lea uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.role_grants g
    where g.user_id = auth.uid() and g.lea_id = p_lea and g.role = 'cte_director'
      and g.revoked_at is null and g.valid_from <= now() and (g.valid_to is null or g.valid_to > now())
  );
$$;

create or replace function app.user_cluster_codes() returns setof text
language sql stable security definer set search_path = ''
as $$
  select g.cluster_code from public.role_grants g
  where g.user_id = auth.uid() and g.cluster_code is not null and g.revoked_at is null
    and g.valid_from <= now() and (g.valid_to is null or g.valid_to > now());
$$;

create or replace function app.my_teacher_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select t.id from public.teachers t where t.profile_id = auth.uid() limit 1; $$;

grant execute on function
  app.profile_active(), app.authed(), app.has_role(app.role), app.is_state_admin(), app.is_staff(),
  app.user_lea_ids(), app.in_lea(uuid), app.manages_lea(uuid), app.directs_lea(uuid), app.user_cluster_codes(), app.my_teacher_id()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Sign-up gate: an auth user may only be created for an open invitation whose
-- email domain is approved. Rejecting here blocks the sign-in itself.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(new.email);
  v_domain text := lower(split_part(new.email, '@', 2));
  inv public.invitations%rowtype;
  v_domain_ok boolean;
begin
  select * into inv from public.invitations i
  where i.email = v_email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  order by i.created_at desc limit 1;

  if not found then
    raise exception 'TAPE Online: % has not been invited' , v_email using errcode = '28000';
  end if;

  if inv.lea_id is not null then
    select exists (select 1 from public.approved_domains d where d.domain = v_domain and d.lea_id = inv.lea_id) into v_domain_ok;
  else
    select exists (select 1 from public.approved_domains d where d.domain = v_domain and d.lea_id is null) into v_domain_ok;
  end if;
  if not v_domain_ok then
    raise exception 'TAPE Online: the domain % is not approved for this invitation', v_domain using errcode = '28000';
  end if;

  insert into public.profiles (id, email, display_name, status)
  values (new.id, v_email, coalesce(inv.display_name, split_part(v_email, '@', 1)), 'active');

  insert into public.role_grants (user_id, role, lea_id, cluster_code, granted_by)
  values (new.id, inv.role, inv.lea_id, inv.cluster_code, inv.invited_by);

  update public.invitations set accepted_at = now(), accepted_user_id = new.id where id = inv.id;

  if inv.teacher_id is not null then
    update public.teachers set profile_id = new.id where id = inv.teacher_id and profile_id is null;
  end if;

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (new.id, 'system', 'auth.user_created', 'profiles', new.id::text, inv.lea_id, jsonb_build_object('invitation_id', inv.id, 'role', inv.role));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.school_years enable row level security;
alter table public.clusters enable row level security;
alter table public.program_catalog enable row level security;
alter table public.leas enable row level security;
alter table public.schools enable row level security;
alter table public.approved_domains enable row level security;
alter table public.holidays enable row level security;
alter table public.profiles enable row level security;
alter table public.role_grants enable row level security;
alter table public.teachers enable row level security;
alter table public.teacher_years enable row level security;
alter table public.invitations enable row level security;
alter table public.staff_pairings enable row level security;
alter table public.audit_events enable row level security;

-- Column privileges: no deletes anywhere for application roles.
grant select, insert, update on public.school_years, public.clusters, public.program_catalog, public.leas, public.schools,
  public.approved_domains, public.holidays, public.profiles, public.role_grants, public.teachers, public.teacher_years,
  public.invitations, public.staff_pairings to authenticated;
grant select on public.audit_events to authenticated;

-- Reference data: readable by every signed-in user, editable by the State Admin.
create policy school_years_read on public.school_years for select to authenticated using (app.authed());
create policy school_years_write on public.school_years for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy clusters_read on public.clusters for select to authenticated using (app.authed());
create policy clusters_write on public.clusters for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy program_catalog_read on public.program_catalog for select to authenticated using (app.authed());
create policy program_catalog_write on public.program_catalog for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy holidays_read on public.holidays for select to authenticated using (app.authed());
create policy holidays_write on public.holidays for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

-- LEAs and schools: staff see all, district roles see their own.
create policy leas_read on public.leas for select to authenticated using (app.authed() and (app.is_staff() or app.in_lea(id)));
create policy leas_write on public.leas for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy schools_read on public.schools for select to authenticated using (app.authed() and (app.is_staff() or app.in_lea(lea_id)));
create policy schools_admin on public.schools for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy schools_lea_update on public.schools for update to authenticated using (app.authed() and app.manages_lea(lea_id)) with check (app.authed() and app.manages_lea(lea_id));

-- Approved domains: State Admin edits; Directors and LEA staff see their own LEA's.
create policy approved_domains_read on public.approved_domains for select to authenticated using (app.authed() and (app.is_state_admin() or (lea_id is not null and app.manages_lea(lea_id))));
create policy approved_domains_write on public.approved_domains for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

-- Profiles: yourself, the State Admin, and staff can see other staff names.
create policy profiles_self on public.profiles for select to authenticated using (app.authed() and id = auth.uid());
create policy profiles_admin on public.profiles for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy profiles_staff_names on public.profiles for select to authenticated using (
  app.authed() and app.is_staff() and exists (
    select 1 from public.role_grants g where g.user_id = profiles.id and g.revoked_at is null and g.role in ('state_admin', 'cluster_admin', 'reviewer', 'leadership')
  )
);
create policy profiles_lea_members on public.profiles for select to authenticated using (
  app.authed() and exists (
    select 1 from public.role_grants g where g.user_id = profiles.id and g.revoked_at is null and g.lea_id is not null and app.manages_lea(g.lea_id)
  )
);

-- Role grants: yourself, the State Admin, and Directors for their LEA.
create policy role_grants_self on public.role_grants for select to authenticated using (app.authed() and user_id = auth.uid());
create policy role_grants_admin on public.role_grants for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy role_grants_lea_read on public.role_grants for select to authenticated using (app.authed() and lea_id is not null and app.manages_lea(lea_id));
-- A Director may revoke teacher and LEA staff seats in their own LEA.
create policy role_grants_lea_revoke on public.role_grants for update to authenticated
  using (app.authed() and lea_id is not null and app.directs_lea(lea_id) and role in ('teacher', 'lea_staff'))
  with check (app.authed() and lea_id is not null and app.directs_lea(lea_id) and role in ('teacher', 'lea_staff'));

-- Teachers: staff read all; district roles read their LEA; teachers read themselves.
create policy teachers_read on public.teachers for select to authenticated using (
  app.authed() and (app.is_staff() or app.manages_lea(lea_id) or profile_id = auth.uid())
);
create policy teachers_admin on public.teachers for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy teachers_lea_write on public.teachers for insert to authenticated with check (app.authed() and app.manages_lea(lea_id));
create policy teachers_lea_update on public.teachers for update to authenticated using (app.authed() and app.manages_lea(lea_id)) with check (app.authed() and app.manages_lea(lea_id));

create policy teacher_years_read on public.teacher_years for select to authenticated using (
  app.authed() and exists (
    select 1 from public.teachers t where t.id = teacher_years.teacher_id and (app.is_staff() or app.manages_lea(t.lea_id) or t.profile_id = auth.uid())
  )
);
create policy teacher_years_admin on public.teacher_years for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy teacher_years_lea_write on public.teacher_years for insert to authenticated with check (
  app.authed() and exists (select 1 from public.teachers t where t.id = teacher_years.teacher_id and app.manages_lea(t.lea_id))
);
create policy teacher_years_lea_update on public.teacher_years for update to authenticated using (
  app.authed() and exists (select 1 from public.teachers t where t.id = teacher_years.teacher_id and app.manages_lea(t.lea_id))
) with check (
  app.authed() and exists (select 1 from public.teachers t where t.id = teacher_years.teacher_id and app.manages_lea(t.lea_id))
);

-- Invitations: State Admin all; Directors invite teachers and LEA staff for their own LEA.
create policy invitations_admin on public.invitations for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy invitations_lea_read on public.invitations for select to authenticated using (app.authed() and lea_id is not null and app.manages_lea(lea_id));
create policy invitations_lea_insert on public.invitations for insert to authenticated with check (
  app.authed() and lea_id is not null and app.directs_lea(lea_id) and role in ('teacher', 'lea_staff') and invited_by = auth.uid()
);
create policy invitations_lea_revoke on public.invitations for update to authenticated
  using (app.authed() and lea_id is not null and app.directs_lea(lea_id) and role in ('teacher', 'lea_staff'))
  with check (app.authed() and lea_id is not null and app.directs_lea(lea_id) and role in ('teacher', 'lea_staff'));

-- Pairings: State Admin edits; staff read.
create policy staff_pairings_read on public.staff_pairings for select to authenticated using (app.authed() and app.is_staff());
create policy staff_pairings_write on public.staff_pairings for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());

-- Audit log: State Admin reads everything; everyone reads their own actions;
-- Directors and LEA staff read events on their LEA's records.
create policy audit_read on public.audit_events for select to authenticated using (
  app.authed() and (app.is_state_admin() or actor_id = auth.uid() or (lea_id is not null and app.manages_lea(lea_id)))
);
