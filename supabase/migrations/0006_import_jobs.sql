-- 0006: import jobs. A spreadsheet is parsed into a plan, previewed, and only
-- then applied. The plan is kept so the apply step works from what was shown.

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cognia_list', 'declarations', 'compliance_list', 'master')),
  file_name text not null,
  school_year_id uuid references public.school_years (id),
  lea_id uuid references public.leas (id),
  plan jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  status text not null default 'previewed' check (status in ('previewed', 'applied', 'discarded')),
  result jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
alter table public.import_jobs enable row level security;
grant select, insert, update on public.import_jobs to authenticated;
create policy import_jobs_admin on public.import_jobs for all to authenticated using (app.authed() and app.is_state_admin()) with check (app.authed() and app.is_state_admin());
create trigger audit_import_jobs after insert or update on public.import_jobs for each row execute function app.audit_row_change();
