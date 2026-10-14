-- Run only in a disposable local database, never on a Supabase project.
create role anon;
create role authenticated;
create function public.lcb_app_user_id() returns text language sql stable as $$
  select nullif(current_setting('test.app_user',true),'')
$$;
create function public.lcb_is_admin() returns boolean language sql stable as $$
  select coalesce(public.lcb_app_user_id() in ('carol','benson'),false)
$$;
create table public.lcb_public_keys(user_id text primary key,public_jwk jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.lcb_private_keys(user_id text primary key,salt text not null,private_iv text not null,private_cipher text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.matters(id text primary key,data jsonb not null,updated_at timestamptz not null default now());
create table public.logs(id text primary key,matter_id text,data jsonb not null,created_at timestamptz not null default now());
create table public.meta(key text primary key,value jsonb not null);
create table public.lcb_matter_keys(matter_id text not null,user_id text not null,wrapped_key text not null,created_at timestamptz not null default now(),primary key(matter_id,user_id));
