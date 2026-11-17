-- 0003: expose the audit event function through the public API schema, and
-- let approved domains be disabled instead of deleted.

create or replace function public.log_event(p_action text, p_entity_type text, p_entity_id text default null, p_lea_id uuid default null, p_meta jsonb default null)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select app.log_event(p_action, p_entity_type, p_entity_id, p_lea_id, p_meta);
$$;
grant execute on function public.log_event(text, text, text, uuid, jsonb) to authenticated;

alter table public.approved_domains add column active boolean not null default true;

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
    select exists (select 1 from public.approved_domains d where d.domain = v_domain and d.lea_id = inv.lea_id and d.active) into v_domain_ok;
  else
    select exists (select 1 from public.approved_domains d where d.domain = v_domain and d.lea_id is null and d.active) into v_domain_ok;
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
