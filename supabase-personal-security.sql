begin;

create or replace function public.carol_personal_user() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email','')) = '13726111370@163.com'
$$;
revoke all on function public.carol_personal_user() from public, anon;
grant execute on function public.carol_personal_user() to authenticated;

create table if not exists public.lcb_public_keys (
  user_id text primary key, public_jwk jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.lcb_private_keys (
  user_id text primary key, salt text not null, private_iv text not null, private_cipher text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.lcb_matter_keys (
  matter_id text not null, user_id text not null, wrapped_key text not null,
  created_at timestamptz not null default now(), primary key (matter_id,user_id)
);

alter table public.matters enable row level security;
alter table public.logs enable row level security;
alter table public.meta enable row level security;
alter table public.lcb_public_keys enable row level security;
alter table public.lcb_private_keys enable row level security;
alter table public.lcb_matter_keys enable row level security;

do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies
    where schemaname='public' and tablename in ('matters','logs','meta','lcb_public_keys','lcb_private_keys','lcb_matter_keys')
  loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;

create policy carol_matters on public.matters for all to authenticated
using (public.carol_personal_user()) with check (public.carol_personal_user());
create policy carol_logs on public.logs for all to authenticated
using (public.carol_personal_user()) with check (public.carol_personal_user());
create policy carol_meta on public.meta for all to authenticated
using (public.carol_personal_user()) with check (public.carol_personal_user());
create policy carol_public_keys on public.lcb_public_keys for all to authenticated
using (public.carol_personal_user() and user_id='carol')
with check (public.carol_personal_user() and user_id='carol');
create policy carol_private_keys on public.lcb_private_keys for all to authenticated
using (public.carol_personal_user() and user_id='carol')
with check (public.carol_personal_user() and user_id='carol');
create policy carol_matter_keys on public.lcb_matter_keys for all to authenticated
using (public.carol_personal_user() and user_id='carol')
with check (public.carol_personal_user() and user_id='carol');

revoke all on public.matters,public.logs,public.meta,public.lcb_public_keys,public.lcb_private_keys,public.lcb_matter_keys from public,anon;
grant select,insert,update,delete on public.matters,public.logs,public.meta,public.lcb_public_keys,public.lcb_private_keys,public.lcb_matter_keys to authenticated;

create or replace function public.lcb_store_wrapped_keys(payload jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare item jsonb; mid text;
begin
  if not public.carol_personal_user() then raise exception 'unknown personal user'; end if;
  for item in select value from jsonb_array_elements(payload)
  loop
    if item->>'user_id' <> 'carol' then raise exception 'invalid key recipient'; end if;
    insert into public.lcb_matter_keys(matter_id,user_id,wrapped_key)
    values(item->>'matter_id','carol',item->>'wrapped_key')
    on conflict(matter_id,user_id) do update set wrapped_key=excluded.wrapped_key;
  end loop;
  for mid in select distinct value->>'matter_id' from jsonb_array_elements(payload)
  loop delete from public.lcb_matter_keys where matter_id=mid and user_id<>'carol'; end loop;
end $$;
revoke all on function public.lcb_store_wrapped_keys(jsonb) from public,anon;
grant execute on function public.lcb_store_wrapped_keys(jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values('carol-encrypted-files','carol-encrypted-files',false,28000000)
on conflict(id) do update set public=false,file_size_limit=28000000;

drop policy if exists carol_files_read on storage.objects;
drop policy if exists carol_files_add on storage.objects;
drop policy if exists carol_files_remove on storage.objects;
create policy carol_files_read on storage.objects for select to authenticated
using(bucket_id='carol-encrypted-files' and public.carol_personal_user());
create policy carol_files_add on storage.objects for insert to authenticated
with check(bucket_id='carol-encrypted-files' and public.carol_personal_user());
create policy carol_files_remove on storage.objects for delete to authenticated
using(bucket_id='carol-encrypted-files' and public.carol_personal_user());

commit;
