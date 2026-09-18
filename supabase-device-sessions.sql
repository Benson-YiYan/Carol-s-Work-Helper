begin;
create table if not exists public.lcb_devices (
  session_id uuid primary key, user_id text not null, device_id text not null, device_name text not null, timezone text not null,
  latitude double precision, longitude double precision,
  ip_address inet,
  created_at timestamptz not null default now(), last_seen timestamptz not null default now()
);
alter table public.lcb_devices add column if not exists device_id text;
alter table public.lcb_devices add column if not exists latitude double precision;
alter table public.lcb_devices add column if not exists longitude double precision;
alter table public.lcb_devices add column if not exists ip_address inet;
delete from public.lcb_devices where device_id is null;
alter table public.lcb_devices alter column device_id set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='lcb_devices_user_device_key') then
    alter table public.lcb_devices add constraint lcb_devices_user_device_key unique(user_id,device_id);
  end if;
end $$;
alter table public.lcb_devices enable row level security;
revoke all on public.lcb_devices from public,anon,authenticated;
create or replace function public.lcb_session_active() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid())
$$;
revoke all on function public.lcb_session_active() from public,anon;
grant execute on function public.lcb_session_active() to authenticated;
create or replace function public.carol_personal_user() returns boolean
language sql stable security definer set search_path=public as $$
  select public.lcb_session_active() and lower(coalesce(auth.jwt()->>'email',''))='13726111370@163.com'
$$;
revoke all on function public.carol_personal_user() from public,anon;
grant execute on function public.carol_personal_user() to authenticated;
drop function if exists public.lcb_register_device(text,text);
drop function if exists public.lcb_register_device(text,text,text);
drop function if exists public.lcb_register_device(text,text,text,double precision,double precision);
create or replace function public.lcb_register_device(p_device_id text, p_device_name text, p_timezone text, p_latitude double precision, p_longitude double precision) returns void
language plpgsql security definer set search_path=public as $$
declare sid uuid; old_sid uuid; current_ip inet;
begin
  sid:=(auth.jwt()->>'session_id')::uuid;
  if not public.carol_personal_user() or sid is null or coalesce(p_device_id,'')='' then raise exception 'invalid session'; end if;
  select s.ip into current_ip from auth.sessions s where s.id=sid;
  select d.session_id into old_sid from public.lcb_devices d where d.user_id='carol' and d.device_id=p_device_id;
  if old_sid is not null and old_sid<>sid then delete from auth.sessions where id=old_sid; end if;
  insert into public.lcb_devices(session_id,user_id,device_id,device_name,timezone,latitude,longitude,ip_address) values(sid,'carol',left(p_device_id,100),left(coalesce(p_device_name,'Unknown device'),120),left(coalesce(p_timezone,'Unknown'),80),p_latitude,p_longitude,current_ip)
  on conflict(user_id,device_id) do update set session_id=excluded.session_id,device_name=excluded.device_name,timezone=excluded.timezone,latitude=excluded.latitude,longitude=excluded.longitude,ip_address=excluded.ip_address,last_seen=now();
end $$;
drop function if exists public.lcb_list_devices();
create or replace function public.lcb_list_devices()
returns table(session_id uuid,user_id text,device_name text,timezone text,latitude double precision,longitude double precision,ip_address text,created_at timestamptz,last_seen timestamptz,is_current boolean)
language sql security definer set search_path=public as $$
  select d.session_id,d.user_id,d.device_name,d.timezone,d.latitude,d.longitude,host(d.ip_address),d.created_at,d.last_seen,d.session_id=(auth.jwt()->>'session_id')::uuid
  from public.lcb_devices d join auth.sessions s on s.id=d.session_id
  where public.carol_personal_user() order by d.last_seen desc
$$;
create or replace function public.lcb_revoke_device(target_session uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.carol_personal_user() then raise exception 'not allowed'; end if;
  delete from auth.sessions where id=target_session;
  delete from public.lcb_devices where session_id=target_session;
end $$;
revoke all on function public.lcb_register_device(text,text,text,double precision,double precision),public.lcb_list_devices(),public.lcb_revoke_device(uuid) from public,anon;
grant execute on function public.lcb_register_device(text,text,text,double precision,double precision),public.lcb_list_devices(),public.lcb_revoke_device(uuid) to authenticated;
commit;
