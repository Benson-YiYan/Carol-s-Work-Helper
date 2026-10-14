-- Forward repair: restore both permitted recipients, but only the caller's private key.
-- Explicit definition avoids ambiguous replacements in security-sensitive functions.
begin;
create or replace function public.lcb_restore_encrypted_backup(payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.lcb_is_admin() then raise exception 'admin required'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(payload->'matters','[]'::jsonb)) x
    where x->'data'->>'encrypted'<>'lcb-e2ee-v1') then raise exception 'plaintext matter rejected'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(payload->'logs','[]'::jsonb)) x
    where x->'data'->>'encrypted'<>'lcb-e2ee-v1') then raise exception 'plaintext log rejected'; end if;
  insert into public.lcb_public_keys(user_id,public_jwk)
    select user_id,public_jwk from jsonb_to_recordset(coalesce(payload->'lcb_public_keys','[]'::jsonb))
      as x(user_id text,public_jwk jsonb)
    where user_id in ('carol','benson')
    on conflict(user_id) do update set public_jwk=excluded.public_jwk,updated_at=now();
  insert into public.lcb_private_keys(user_id,salt,private_iv,private_cipher)
    select user_id,salt,private_iv,private_cipher from
      jsonb_to_recordset(coalesce(payload->'lcb_private_keys','[]'::jsonb))
      as x(user_id text,salt text,private_iv text,private_cipher text)
    where user_id=public.lcb_app_user_id()
    on conflict(user_id) do update set salt=excluded.salt,private_iv=excluded.private_iv,
      private_cipher=excluded.private_cipher,updated_at=now();
  insert into public.matters(id,data,updated_at)
    select id,data,coalesce(updated_at,now()) from
      jsonb_to_recordset(coalesce(payload->'matters','[]'::jsonb))
      as x(id text,data jsonb,updated_at timestamptz)
    on conflict(id) do update set data=excluded.data,updated_at=excluded.updated_at;
  insert into public.logs(id,matter_id,data)
    select id,matter_id,data from jsonb_to_recordset(coalesce(payload->'logs','[]'::jsonb))
      as x(id text,matter_id text,data jsonb)
    on conflict(id) do update set matter_id=excluded.matter_id,data=excluded.data;
  insert into public.meta(key,value)
    select key,value from jsonb_to_recordset(coalesce(payload->'meta','[]'::jsonb))
      as x(key text,value jsonb)
    on conflict(key) do update set value=excluded.value;
  insert into public.lcb_matter_keys(matter_id,user_id,wrapped_key)
    select matter_id,user_id,wrapped_key from
      jsonb_to_recordset(coalesce(payload->'lcb_matter_keys','[]'::jsonb))
      as x(matter_id text,user_id text,wrapped_key text)
    where user_id in ('carol','benson')
    on conflict(matter_id,user_id) do update set wrapped_key=excluded.wrapped_key;
end $$;
revoke all on function public.lcb_restore_encrypted_backup(jsonb) from public,anon;
grant execute on function public.lcb_restore_encrypted_backup(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
