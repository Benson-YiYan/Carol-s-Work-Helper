begin;

-- Keep the mother-son identity and visibility boundary explicit in this migration.
create or replace function public.lcb_app_user_id() returns text
language sql stable security definer set search_path=public as $$
  select case lower(coalesce(auth.jwt()->>'email',''))
    when '13726111370@163.com' then 'carol'
    when 'yanyi13411696203@163.com' then 'benson'
    else null
  end
  where exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid())
$$;
revoke all on function public.lcb_app_user_id() from public,anon;
grant execute on function public.lcb_app_user_id() to authenticated;

create or replace function public.lcb_matter_visible(payload jsonb) returns boolean
language sql stable security definer set search_path=public as $$
  select public.lcb_app_user_id()='carol'
    or payload->>'owner'=public.lcb_app_user_id()
    or coalesce(payload->'team','[]'::jsonb) ? public.lcb_app_user_id()
$$;
revoke all on function public.lcb_matter_visible(jsonb) from public,anon;
grant execute on function public.lcb_matter_visible(jsonb) to authenticated;

-- Login throttling used by the lcb-login Edge Function.
create table if not exists public.lcb_login_locks (
  email text not null,
  device_id text not null,
  failures integer not null default 0 check (failures between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (email, device_id)
);
alter table public.lcb_login_locks enable row level security;
revoke all on table public.lcb_login_locks from public, anon, authenticated;
grant all on table public.lcb_login_locks to service_role;

create or replace function public.lcb_record_login_failure(p_email text, p_device_id text)
returns table(failures integer, locked_until timestamptz)
language plpgsql security definer set search_path=public as $$
declare
  normalized_email text:=lower(trim(p_email));
  current_row public.lcb_login_locks%rowtype;
  next_failures integer;
  next_locked_until timestamptz;
begin
  if normalized_email='' or coalesce(trim(p_device_id),'')='' then raise exception 'email and device are required'; end if;
  select * into current_row from public.lcb_login_locks
    where email=normalized_email and device_id=p_device_id for update;
  if not found or (current_row.locked_until is not null and current_row.locked_until<=now()) then
    next_failures:=1;
  elsif current_row.locked_until is not null then
    return query select current_row.failures,current_row.locked_until;
    return;
  else
    next_failures:=least(current_row.failures+1,5);
  end if;
  next_locked_until:=case when next_failures>=5 then now()+interval '5 minutes' else null end;
  insert into public.lcb_login_locks(email,device_id,failures,locked_until,updated_at)
    values(normalized_email,p_device_id,next_failures,next_locked_until,now())
    on conflict(email,device_id) do update set failures=excluded.failures,locked_until=excluded.locked_until,updated_at=excluded.updated_at;
  return query select next_failures,next_locked_until;
end $$;
revoke all on function public.lcb_record_login_failure(text,text) from public,anon,authenticated;
grant execute on function public.lcb_record_login_failure(text,text) to service_role;

-- Optimistic concurrency used by the current team frontend.
create or replace function public.lcb_store_matters_if_current(payload jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare item jsonb; matter_id text; expected_at timestamptz; next_at timestamptz;
begin
  if public.lcb_app_user_id() is null then raise exception 'unknown app user'; end if;
  for item in select value from jsonb_array_elements(coalesce(payload,'[]'::jsonb)) loop
    matter_id:=item->>'id';
    expected_at:=nullif(item->>'expected_updated_at','')::timestamptz;
    next_at:=(item->>'updated_at')::timestamptz;
    if expected_at is null then
      update public.matters set data=item->'data',updated_at=next_at
        where id=matter_id and data->>'encrypted'='lcb-e2ee-pending';
    else
      update public.matters set data=item->'data',updated_at=next_at
        where id=matter_id and updated_at=expected_at;
    end if;
    if not found then raise exception 'matter_conflict:%',matter_id using errcode='P0001'; end if;
  end loop;
  return true;
end $$;
revoke all on function public.lcb_store_matters_if_current(jsonb) from public,anon;
grant execute on function public.lcb_store_matters_if_current(jsonb) to authenticated;

-- Precise device coordinates are intentionally not accepted or returned.
-- Revoke the legacy coordinate-bearing RPCs while keeping their table columns
-- untouched until the owner separately approves clearing historic values.
do $$ begin
  if to_regprocedure('public.lcb_register_device(text,text,text,double precision,double precision)') is not null then
    execute 'revoke all on function public.lcb_register_device(text,text,text,double precision,double precision) from public,anon,authenticated';
  end if;
  if to_regprocedure('public.lcb_list_devices()') is not null then
    execute 'revoke all on function public.lcb_list_devices() from public,anon,authenticated';
  end if;
end $$;

create or replace function public.lcb_register_device_safe(p_device_id text,p_device_name text,p_timezone text)
returns void language plpgsql security definer set search_path=public as $$
declare sid uuid; old_sid uuid; current_ip inet; uid text:=public.lcb_app_user_id();
begin
  sid:=(auth.jwt()->>'session_id')::uuid;
  if uid is null or sid is null or coalesce(p_device_id,'')='' then raise exception 'invalid session'; end if;
  select s.ip into current_ip from auth.sessions s where s.id=sid;
  select d.session_id into old_sid from public.lcb_devices d where d.user_id=uid and d.device_id=p_device_id;
  if old_sid is not null and old_sid<>sid then delete from auth.sessions where id=old_sid; end if;
  insert into public.lcb_devices(session_id,user_id,device_id,device_name,timezone,ip_address)
    values(sid,uid,left(p_device_id,100),left(coalesce(p_device_name,'Unknown device'),120),left(coalesce(p_timezone,'Unknown'),80),current_ip)
    on conflict(user_id,device_id) do update set
      session_id=excluded.session_id,device_name=excluded.device_name,timezone=excluded.timezone,
      ip_address=excluded.ip_address,last_seen=now();
end $$;

create or replace function public.lcb_list_devices_safe()
returns table(session_id uuid,user_id text,device_name text,timezone text,city text,ip_address text,created_at timestamptz,last_seen timestamptz,is_current boolean)
language sql security definer set search_path=public as $$
  select d.session_id,d.user_id,d.device_name,d.timezone,null::text,host(d.ip_address),d.created_at,d.last_seen,
    d.session_id=(auth.jwt()->>'session_id')::uuid
  from public.lcb_devices d join auth.sessions s on s.id=d.session_id
  where d.user_id=public.lcb_app_user_id() order by d.last_seen desc
$$;
revoke all on function public.lcb_register_device_safe(text,text,text),public.lcb_list_devices_safe() from public,anon;
grant execute on function public.lcb_register_device_safe(text,text,text),public.lcb_list_devices_safe() to authenticated;

-- Admin-only encrypted backup restore, constrained to mother-son users.
create or replace function public.lcb_restore_encrypted_backup(payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.lcb_app_user_id()<>'carol' then raise exception 'admin required'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(payload->'matters','[]'::jsonb)) x where x->'data'->>'encrypted'<>'lcb-e2ee-v1') then raise exception 'plaintext matter rejected'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(payload->'logs','[]'::jsonb)) x where x->'data'->>'encrypted'<>'lcb-e2ee-v1') then raise exception 'plaintext log rejected'; end if;
  insert into public.lcb_public_keys(user_id,public_jwk)
    select user_id,public_jwk from jsonb_to_recordset(coalesce(payload->'lcb_public_keys','[]'::jsonb)) as x(user_id text,public_jwk jsonb)
    where user_id in ('carol','benson') on conflict(user_id) do update set public_jwk=excluded.public_jwk,updated_at=now();
  insert into public.lcb_private_keys(user_id,salt,private_iv,private_cipher)
    select user_id,salt,private_iv,private_cipher from jsonb_to_recordset(coalesce(payload->'lcb_private_keys','[]'::jsonb)) as x(user_id text,salt text,private_iv text,private_cipher text)
    where user_id='carol' on conflict(user_id) do update set salt=excluded.salt,private_iv=excluded.private_iv,private_cipher=excluded.private_cipher,updated_at=now();
  insert into public.matters(id,data,updated_at)
    select id,data,coalesce(updated_at,now()) from jsonb_to_recordset(coalesce(payload->'matters','[]'::jsonb)) as x(id text,data jsonb,updated_at timestamptz)
    on conflict(id) do update set data=excluded.data,updated_at=excluded.updated_at;
  insert into public.logs(id,matter_id,data)
    select id,matter_id,data from jsonb_to_recordset(coalesce(payload->'logs','[]'::jsonb)) as x(id text,matter_id text,data jsonb)
    on conflict(id) do update set matter_id=excluded.matter_id,data=excluded.data;
  insert into public.meta(key,value)
    select key,value from jsonb_to_recordset(coalesce(payload->'meta','[]'::jsonb)) as x(key text,value jsonb)
    on conflict(key) do update set value=excluded.value;
  insert into public.lcb_matter_keys(matter_id,user_id,wrapped_key)
    select matter_id,user_id,wrapped_key from jsonb_to_recordset(coalesce(payload->'lcb_matter_keys','[]'::jsonb)) as x(matter_id text,user_id text,wrapped_key text)
    where user_id='carol' on conflict(matter_id,user_id) do update set wrapped_key=excluded.wrapped_key;
end $$;
revoke all on function public.lcb_restore_encrypted_backup(jsonb) from public,anon;
grant execute on function public.lcb_restore_encrypted_backup(jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values('carol-encrypted-files','carol-encrypted-files',false,28000000)
on conflict(id) do update set public=false,file_size_limit=28000000;

commit;
