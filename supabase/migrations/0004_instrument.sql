-- 0004: the versioned instrument. QPI text, descriptors, sub-items, EPIC
-- descriptors, scoring rules, and the role checklists are data keyed to a
-- school year. A review is bound to the version it was scored under.

create table public.instrument_versions (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years (id),
  level text not null default 'secondary' check (level in ('secondary', 'middle')),
  label text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  notes text,
  created_at timestamptz not null default now(),
  unique (school_year_id, level, label)
);

create table public.instrument_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.instrument_versions (id) on delete cascade,
  code text not null,
  title text not null,
  purpose text,
  sort integer not null default 0,
  unique (version_id, code)
);

create table public.qpis (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.instrument_versions (id) on delete cascade,
  section_id uuid not null references public.instrument_sections (id) on delete cascade,
  code text not null,
  title text not null,
  descriptor text not null,
  applies_to text not null default 'non_coop' check (applies_to in ('all', 'coop_only', 'non_coop')),
  assurance_based boolean not null default false,
  onsite boolean not null default false,
  per_teacher boolean not null default false,
  satisfied_by_ase boolean not null default false,
  dual_scenario3_included boolean not null default false,
  random_audit_kind text,
  allows_na boolean not null default true,
  sort integer not null default 0,
  unique (version_id, code)
);

create table public.qpi_subitems (
  id uuid primary key default gen_random_uuid(),
  qpi_id uuid not null references public.qpis (id) on delete cascade,
  text text not null,
  allows_na boolean not null default false,
  sort integer not null default 0
);

create table public.epic_descriptors (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.instrument_versions (id) on delete cascade,
  section_id uuid not null references public.instrument_sections (id) on delete cascade,
  text text not null,
  sort integer not null default 0
);

create table public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.instrument_versions (id) on delete cascade,
  rule_key text not null,
  label text not null,
  operator text not null check (operator in ('>=', '>', '<=', '<', '=')),
  threshold numeric not null,
  epic_threshold numeric,
  unit text not null default 'percent',
  unique (version_id, rule_key)
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.instrument_versions (id) on delete cascade,
  role text not null check (role in ('director', 'reviewer')),
  text text not null,
  sort integer not null default 0
);

-- Published versions cannot change. Corrections mean a new version.
create or replace function app.instrument_locked(p_version uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.instrument_versions v where v.id = p_version and v.status <> 'draft'); $$;

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

create trigger guard_instrument_versions before update on public.instrument_versions for each row execute function app.guard_instrument_change();
create trigger guard_instrument_sections before insert or update or delete on public.instrument_sections for each row execute function app.guard_instrument_change();
create trigger guard_qpis before insert or update or delete on public.qpis for each row execute function app.guard_instrument_change();
create trigger guard_qpi_subitems before insert or update or delete on public.qpi_subitems for each row execute function app.guard_instrument_change();
create trigger guard_epic_descriptors before insert or update or delete on public.epic_descriptors for each row execute function app.guard_instrument_change();
create trigger guard_scoring_rules before insert or update or delete on public.scoring_rules for each row execute function app.guard_instrument_change();
create trigger guard_checklist_items before insert or update or delete on public.checklist_items for each row execute function app.guard_instrument_change();

create trigger audit_instrument_versions after insert or update or delete on public.instrument_versions for each row execute function app.audit_row_change();
create trigger audit_qpis after insert or update or delete on public.qpis for each row execute function app.audit_row_change();
create trigger audit_scoring_rules after insert or update or delete on public.scoring_rules for each row execute function app.audit_row_change();

alter table public.instrument_versions enable row level security;
alter table public.instrument_sections enable row level security;
alter table public.qpis enable row level security;
alter table public.qpi_subitems enable row level security;
alter table public.epic_descriptors enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.checklist_items enable row level security;

grant select, insert, update, delete on public.instrument_versions, public.instrument_sections, public.qpis, public.qpi_subitems,
  public.epic_descriptors, public.scoring_rules, public.checklist_items to authenticated;

-- Drafts are visible to ALSDE staff; published and retired versions to everyone signed in.
create or replace function app.instrument_visible(p_version uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.instrument_versions v where v.id = p_version and (v.status <> 'draft' or app.is_staff()));
$$;
grant execute on function app.instrument_visible(uuid), app.instrument_locked(uuid) to authenticated;

create policy instrument_versions_read on public.instrument_versions for select to authenticated using (app.authed() and (status <> 'draft' or app.is_staff()));
create policy instrument_versions_write on public.instrument_versions for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy instrument_sections_read on public.instrument_sections for select to authenticated using (app.authed() and app.instrument_visible(version_id));
create policy instrument_sections_write on public.instrument_sections for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy qpis_read on public.qpis for select to authenticated using (app.authed() and app.instrument_visible(version_id));
create policy qpis_write on public.qpis for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy qpi_subitems_read on public.qpi_subitems for select to authenticated using (app.authed() and exists (select 1 from public.qpis q where q.id = qpi_subitems.qpi_id and app.instrument_visible(q.version_id)));
create policy qpi_subitems_write on public.qpi_subitems for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy epic_descriptors_read on public.epic_descriptors for select to authenticated using (app.authed() and app.instrument_visible(version_id));
create policy epic_descriptors_write on public.epic_descriptors for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy scoring_rules_read on public.scoring_rules for select to authenticated using (app.authed() and app.instrument_visible(version_id));
create policy scoring_rules_write on public.scoring_rules for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create policy checklist_items_read on public.checklist_items for select to authenticated using (app.authed() and app.instrument_visible(version_id));
create policy checklist_items_write on public.checklist_items for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
