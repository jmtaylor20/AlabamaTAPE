-- 0009: Program Improvement Plans.
--
-- A PIP belongs to one finalized program review and carries one goal per open
-- finding. The clock starts the day after the ten-day close and runs twelve
-- months. The reviewer writes goals and monthly progress; the Director and
-- teachers add notes and evidence; escalations at months 6, 9, and 11 are
-- recorded automatically when goals remain incomplete; the State Admin closes.

create table public.pips (
  id uuid primary key default gen_random_uuid(),
  program_review_id uuid not null unique references public.program_reviews (id),
  status text not null default 'open' check (status in ('open', 'closed')),
  ten_day_close date not null,
  starts_on date not null,
  due_on date not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  close_note text
);

create table public.pip_goals (
  id uuid primary key default gen_random_uuid(),
  pip_id uuid not null references public.pips (id) on delete cascade,
  finding_id uuid unique references public.findings (id),
  qpi_code text not null,
  action_steps text not null default '',
  status text check (status in ('ten_days', 'one_year', 'not_complete')),
  date_accomplished date,
  sort integer not null default 0,
  created_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index pip_goals_pip on public.pip_goals (pip_id);

create table public.pip_progress (
  id uuid primary key default gen_random_uuid(),
  pip_id uuid not null references public.pips (id) on delete cascade,
  month integer not null check (month between 1 and 12),
  body text not null,
  progress_lacking boolean not null default false,
  entered_by uuid not null references public.profiles (id),
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pip_id, month)
);

create table public.pip_notes (
  id uuid primary key default gen_random_uuid(),
  pip_id uuid not null references public.pips (id) on delete cascade,
  goal_id uuid references public.pip_goals (id) on delete set null,
  author_role text not null check (author_role in ('director', 'teacher', 'reviewer')),
  body text not null,
  evidence_file_id uuid references public.evidence_files (id),
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index pip_notes_pip on public.pip_notes (pip_id, created_at);

create table public.pip_escalations (
  id uuid primary key default gen_random_uuid(),
  pip_id uuid not null references public.pips (id) on delete cascade,
  month integer not null check (month in (6, 9, 11)),
  open_goals integer not null,
  notified jsonb not null default '[]'::jsonb,
  notified_at timestamptz not null default now(),
  unique (pip_id, month)
);
create trigger pip_escalations_immutable before update or delete on public.pip_escalations for each row execute function app.reject_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.pip_program_review(p_pip uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select p.program_review_id from public.pips p where p.id = p_pip; $$;

create or replace function app.pip_lea(p_pip uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select r.lea_id from public.pips p join public.program_reviews pr on pr.id = p.program_review_id join public.lea_reviews r on r.id = pr.lea_review_id where p.id = p_pip; $$;

create or replace function app.pip_open(p_pip uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.pips p where p.id = p_pip and p.status = 'open'); $$;

create or replace function app.teacher_on_pip(p_pip uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.pips p join public.program_review_sites s on s.program_review_id = p.program_review_id
    join public.program_review_site_teachers t on t.site_id = s.id
    where p.id = p_pip and t.teacher_id = app.my_teacher_id()
  );
$$;

-- Everyone who may read a PIP in full (leadership reads status only, handled in the policy).
create or replace function app.can_read_pip(p_pip uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_state_admin()
    or app.assigned_to_program_review(app.pip_program_review(p_pip))
    or (app.has_role('cluster_admin') and app.cluster_admin_for_program((select pr.program_code from public.program_reviews pr where pr.id = app.pip_program_review(p_pip))))
    or app.manages_lea(app.pip_lea(p_pip))
    or app.teacher_on_pip(p_pip);
$$;

create or replace function app.may_write_pip(p_pip uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select app.pip_open(p_pip) and (app.assigned_to_program_review(app.pip_program_review(p_pip)) or app.is_state_admin()); $$;

grant execute on function app.pip_program_review(uuid), app.pip_lea(uuid), app.pip_open(uuid), app.teacher_on_pip(uuid), app.can_read_pip(uuid), app.may_write_pip(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create or replace function app.create_pip(p_pr uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r public.program_reviews%rowtype; v_close date; v_pip uuid; n int;
begin
  select * into r from public.program_reviews where id = p_pr;
  if r.id is null then raise exception 'review not found'; end if;
  if not app.authed() or not (app.assigned_to_program_review(p_pr) or app.is_state_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.finalized_at is null then raise exception 'finalize the review before creating a PIP'; end if;
  if exists (select 1 from public.pips where program_review_id = p_pr) then raise exception 'this review already has a PIP'; end if;
  v_close := app.milestone_date(r.lea_review_id, 'ten_day_close');
  if v_close is null then raise exception 'the review has no visit dates, so the ten-day close is unknown'; end if;
  insert into public.pips (program_review_id, ten_day_close, starts_on, due_on, created_by)
  values (p_pr, v_close, v_close + 1, (v_close + 1) + interval '12 months', auth.uid()) returning id into v_pip;
  insert into public.pip_goals (pip_id, finding_id, qpi_code, action_steps, sort, created_by)
  select v_pip, f.id, f.qpi_code, '', row_number() over (order by f.qpi_code), auth.uid()
  from public.findings f join public.program_review_sites s on s.id = f.site_id
  where s.program_review_id = p_pr and f.status = 'open';
  get diagnostics n = row_count;
  update public.milestones set completed_at = now() where lea_review_id = r.lea_review_id and kind = 'pip_start' and completed_at is null;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'pip.created', 'pips', v_pip::text, app.pip_lea(v_pip), jsonb_build_object('goals', n, 'due_on', (v_close + 1) + interval '12 months'));
  return v_pip;
end;
$$;

-- Concluded: finalized, and either no open findings or a PIP exists for them.
create or replace function app.conclude_program_review(p_pr uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.program_reviews%rowtype; open_findings int;
begin
  select * into r from public.program_reviews where id = p_pr;
  if r.id is null then raise exception 'review not found'; end if;
  if not app.authed() or not (app.assigned_to_program_review(p_pr) or app.is_state_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.finalized_at is null then raise exception 'finalize the review first'; end if;
  select count(*) into open_findings from public.findings f join public.program_review_sites s on s.id = f.site_id where s.program_review_id = p_pr and f.status = 'open';
  if open_findings > 0 and not exists (select 1 from public.pips where program_review_id = p_pr) then raise exception 'create the PIP for the % open finding(s) first', open_findings; end if;
  update public.program_reviews set status = 'concluded', updated_at = now() where id = p_pr;
  if not exists (select 1 from public.program_reviews x where x.lea_review_id = r.lea_review_id and x.status not in ('concluded', 'removed')) then
    update public.lea_reviews set status = 'concluded', concluded_at = now(), updated_at = now() where id = r.lea_review_id;
  end if;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id)
  values (auth.uid(), auth.role(), 'program_review.concluded', 'program_reviews', p_pr::text, (select lea_id from public.lea_reviews where id = r.lea_review_id));
end;
$$;

create or replace function app.close_pip(p_pip uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_pr uuid;
begin
  if not app.authed() or not app.is_state_admin() then raise exception 'only the State Admin closes a PIP' using errcode = '42501'; end if;
  if p_note is null or length(trim(p_note)) < 2 then raise exception 'a closing note is required'; end if;
  update public.pips set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = p_note where id = p_pip and status = 'open';
  if not found then raise exception 'this PIP is not open'; end if;
  v_pr := app.pip_program_review(p_pip);
  update public.milestones set completed_at = now() where lea_review_id = (select lea_review_id from public.program_reviews where id = v_pr) and kind = 'pip_due' and completed_at is null;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
  values (auth.uid(), auth.role(), 'pip.closed', 'pips', p_pip::text, app.pip_lea(p_pip), jsonb_build_object('note', p_note));
end;
$$;

-- Escalations: at months 6, 9, and 11 after the start, any open PIP with goals
-- not yet accomplished gets one row naming the cluster administrators on the
-- review and the State Admins. Safe to run as often as wanted.
create or replace function app.run_pip_escalations() returns integer
language plpgsql security definer set search_path = ''
as $$
declare rec record; m int; n int := 0; open_goals int; who jsonb;
begin
  for rec in select p.id, p.starts_on, p.program_review_id from public.pips p where p.status = 'open' loop
    foreach m in array array[6, 9, 11] loop
      if current_date < rec.starts_on + (m || ' months')::interval then continue; end if;
      if exists (select 1 from public.pip_escalations e where e.pip_id = rec.id and e.month = m) then continue; end if;
      select count(*) into open_goals from public.pip_goals g where g.pip_id = rec.id and (g.status is null or g.status = 'not_complete');
      if open_goals = 0 then continue; end if;
      select coalesce(jsonb_agg(distinct x.email), '[]'::jsonb) into who from (
        select a.email from public.review_assignments a where a.program_review_id = rec.program_review_id and a.assignment_role = 'cluster_admin' and a.revoked_at is null
        union select pr.email from public.role_grants g join public.profiles pr on pr.id = g.user_id where g.role = 'state_admin' and g.revoked_at is null
      ) x;
      insert into public.pip_escalations (pip_id, month, open_goals, notified) values (rec.id, m, open_goals, who);
      insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, lea_id, meta)
      values (auth.uid(), coalesce(auth.role(), 'service_role'), 'pip.escalated', 'pips', rec.id::text, app.pip_lea(rec.id), jsonb_build_object('month', m, 'open_goals', open_goals, 'notified', who));
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;

grant execute on function app.create_pip(uuid), app.conclude_program_review(uuid), app.close_pip(uuid, text) to authenticated;
grant execute on function app.run_pip_escalations() to authenticated, service_role;
create or replace function public.create_pip(p_pr uuid) returns uuid language sql security invoker set search_path = '' as $$ select app.create_pip(p_pr); $$;
create or replace function public.conclude_program_review(p_pr uuid) returns void language sql security invoker set search_path = '' as $$ select app.conclude_program_review(p_pr); $$;
create or replace function public.close_pip(p_pip uuid, p_note text) returns void language sql security invoker set search_path = '' as $$ select app.close_pip(p_pip, p_note); $$;
-- Running the escalation check by hand is a State Admin action; the scheduled job runs as the service role.
create or replace function public.run_pip_escalations() returns integer language plpgsql security invoker set search_path = '' as $$
begin
  if auth.role() = 'authenticated' and not app.is_state_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return app.run_pip_escalations();
end; $$;
grant execute on function public.create_pip(uuid), public.conclude_program_review(uuid), public.close_pip(uuid, text), public.run_pip_escalations() to authenticated;
grant execute on function public.run_pip_escalations() to service_role;

-- ---------------------------------------------------------------------------
-- Audit triggers and row-level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pips', 'pip_goals', 'pip_progress', 'pip_notes']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

alter table public.pips enable row level security;
alter table public.pip_goals enable row level security;
alter table public.pip_progress enable row level security;
alter table public.pip_notes enable row level security;
alter table public.pip_escalations enable row level security;

grant select on public.pips, public.pip_escalations to authenticated;
grant select, insert, update on public.pip_goals, public.pip_progress to authenticated;
grant select, insert on public.pip_notes to authenticated;

-- Leadership reads the PIP row (status and dates) and nothing below it.
create policy pips_read on public.pips for select to authenticated using (app.authed() and (app.has_role('leadership') or app.can_read_pip(id)));

create policy pip_goals_read on public.pip_goals for select to authenticated using (app.authed() and app.can_read_pip(pip_id));
create policy pip_goals_write on public.pip_goals for all to authenticated
  using (app.authed() and app.may_write_pip(pip_id)) with check (app.authed() and app.may_write_pip(pip_id));

create policy pip_progress_read on public.pip_progress for select to authenticated using (app.authed() and app.can_read_pip(pip_id));
create policy pip_progress_write on public.pip_progress for all to authenticated
  using (app.authed() and app.may_write_pip(pip_id)) with check (app.authed() and entered_by = auth.uid() and app.may_write_pip(pip_id));

create policy pip_notes_read on public.pip_notes for select to authenticated using (app.authed() and app.can_read_pip(pip_id));
create policy pip_notes_insert on public.pip_notes for insert to authenticated with check (
  app.authed() and author_id = auth.uid() and app.pip_open(pip_id) and (
    (author_role = 'reviewer' and (app.assigned_to_program_review(app.pip_program_review(pip_id)) or app.is_state_admin()))
    or (author_role = 'director' and app.manages_lea(app.pip_lea(pip_id)))
    or (author_role = 'teacher' and app.teacher_on_pip(pip_id))
  )
  and (evidence_file_id is null or app.can_see_evidence(evidence_file_id))
);

create policy pip_escalations_read on public.pip_escalations for select to authenticated using (app.authed() and (app.is_staff() or app.manages_lea(app.pip_lea(pip_id))));
