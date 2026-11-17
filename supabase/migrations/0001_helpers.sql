-- 0001: extensions and the helper functions every policy builds on.
-- Nothing here stores data. The real schema arrives in phase 1.

create extension if not exists pgcrypto;

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- Authentication Assurance Level from the session's JWT.
-- Supabase sets aal2 only after the user passes a second factor.
create or replace function app.session_aal() returns text
language sql stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;

-- True only for a signed-in session that has completed multi-factor authentication.
-- Every data policy requires this, so a session without MFA reads nothing.
create or replace function app.has_mfa() returns boolean
language sql stable
set search_path = ''
as $$
  select auth.uid() is not null and app.session_aal() = 'aal2';
$$;

-- Seconds since the session's most recent authentication method was verified.
-- Used by the finalization step-up check in phase 4.
create or replace function app.seconds_since_last_auth() returns integer
language sql stable
set search_path = ''
as $$
  select coalesce(
    (select extract(epoch from now())::integer - max((m ->> 'timestamp')::integer)
       from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as m),
    2147483647
  );
$$;

grant execute on function app.session_aal(), app.has_mfa(), app.seconds_since_last_auth() to anon, authenticated, service_role;

-- Default privileges: nothing is readable until a policy grants it.
alter default privileges in schema public revoke all on tables from anon, authenticated;
