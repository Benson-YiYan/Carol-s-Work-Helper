begin;
do $$
declare s record;
begin
  select sessions.id as session_id,sessions.user_id,u.email into s
  from auth.sessions sessions join auth.users u on u.id=sessions.user_id
  where lower(u.email)='yanyi13411696203@163.com' limit 1;
  if not found then raise exception 'A valid Benson session is required for this access test'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',s.user_id,'email',s.email,'session_id',s.session_id)::text,true);
  if public.lcb_app_user_id() is distinct from 'benson' then raise exception 'Benson identity changed'; end if;
  if not public.lcb_is_admin() then raise exception 'Benson administrator access missing'; end if;
  if not public.lcb_matter_visible('{}'::jsonb) then raise exception 'Administrator visibility missing'; end if;
  if has_function_privilege('anon','public.lcb_is_admin()','execute') then raise exception 'Anonymous administrator RPC access'; end if;
  if not exists(select 1 from pg_policies where tablename='lcb_private_keys' and policyname='family_private_keys'
    and qual='(user_id = lcb_app_user_id())' and with_check='(user_id = lcb_app_user_id())')
    then raise exception 'Personal encrypted private key isolation changed'; end if;
  perform set_config('request.jwt.claims','{}',true);
  if public.lcb_is_admin() then raise exception 'Anonymous session is administrator'; end if;
end $$;
rollback;
