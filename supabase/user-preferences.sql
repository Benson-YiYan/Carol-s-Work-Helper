create table if not exists public.lcb_user_preferences (
  user_id text primary key,
  value jsonb not null default '{}'::jsonb
);
alter table public.lcb_user_preferences enable row level security;
revoke all on public.lcb_user_preferences from public,anon,authenticated;
create or replace function public.lcb_get_user_preferences() returns jsonb
language plpgsql security definer set search_path=public as $$
declare app_user text:=public.lcb_app_user_id();
begin
  if app_user is null then raise exception 'authentication required'; end if;
  return coalesce((select value from public.lcb_user_preferences where user_id=app_user),'{}'::jsonb);
end $$;
create or replace function public.lcb_set_user_preferences(payload jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare app_user text:=public.lcb_app_user_id();
begin
  if app_user is null then raise exception 'authentication required'; end if;
  if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>10000 then
    raise exception 'invalid preferences';
  end if;
  insert into public.lcb_user_preferences(user_id,value) values(app_user,payload)
  on conflict(user_id) do update set value=excluded.value;
end $$;
revoke all on function public.lcb_get_user_preferences() from public,anon;
revoke all on function public.lcb_set_user_preferences(jsonb) from public,anon;
grant execute on function public.lcb_get_user_preferences() to authenticated;
grant execute on function public.lcb_set_user_preferences(jsonb) to authenticated;
