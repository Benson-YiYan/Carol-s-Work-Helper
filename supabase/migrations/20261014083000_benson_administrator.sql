begin;
-- Mother-son project only. Keep identities, private keys and chat-author rules separate.
create or replace function public.lcb_is_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce(public.lcb_app_user_id() in ('carol','benson'),false)
$$;
revoke all on function public.lcb_is_admin() from public,anon;
grant execute on function public.lcb_is_admin() to authenticated;

-- Replace only the existing administrator predicates; do not broaden personal-key policies.
do $$
declare p record; q text; w text; statement text;
begin
  for p in select * from pg_policies where schemaname in ('public','storage') loop
    q:=replace(p.qual,'lcb_app_user_id() = ''carol''::text','lcb_is_admin()');
    w:=replace(p.with_check,'lcb_app_user_id() = ''carol''::text','lcb_is_admin()');
    if q is distinct from p.qual or w is distinct from p.with_check then
      statement:=format('alter policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
      if q is not null then statement:=statement||' using ('||q||')'; end if;
      if w is not null then statement:=statement||' with check ('||w||')'; end if;
      execute statement;
    end if;
  end loop;
end $$;

do $$
declare name text; definition text;
begin
  foreach name in array array['lcb_matter_visible(jsonb)','lcb_protect_matter_access_fields()','lcb_store_wrapped_keys(jsonb)','lcb_restore_encrypted_backup(jsonb)'] loop
    definition:=pg_get_functiondef(('public.'||name)::regprocedure);
    definition:=replace(definition,'public.lcb_app_user_id()=''carol''','public.lcb_is_admin()');
    definition:=replace(definition,'public.lcb_app_user_id()<>''carol''','not public.lcb_is_admin()');
    definition:=replace(definition,'uid<>''carol''','not public.lcb_is_admin()');
    definition:=replace(definition,'uid=''carol''','public.lcb_is_admin()');
    if name='lcb_store_wrapped_keys(jsonb)' then
      definition:=replace(definition,'item->>''user_id''<>''carol''','item->>''user_id'' not in (''carol'',''benson'')');
      definition:=replace(definition,'k.user_id<>''carol''','k.user_id not in (''carol'',''benson'')');
    end if;
    if name='lcb_restore_encrypted_backup(jsonb)' then
      -- A restore must never replace the other account's encrypted private key.
      definition:=replace(definition,'where user_id=''carol''','where user_id=public.lcb_app_user_id()');
    end if;
    execute definition;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
