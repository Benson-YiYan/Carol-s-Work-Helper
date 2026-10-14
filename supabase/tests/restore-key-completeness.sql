-- Disposable LOCAL database only. Every fixture is rolled back.
begin;
do $$
declare caller text; other_user text; payload jsonb;
begin
  foreach caller in array array['carol','benson'] loop
    other_user:=case caller when 'carol' then 'benson' else 'carol' end;
    perform set_config('test.app_user',caller,true);
    truncate public.lcb_matter_keys,public.lcb_private_keys,public.lcb_public_keys,public.logs,public.matters,public.meta;
    insert into public.lcb_private_keys(user_id,salt,private_iv,private_cipher)
      values('carol','old','old','original-carol'),('benson','old','old','original-benson');
    payload:=jsonb_build_object(
      'matters',jsonb_build_array(jsonb_build_object('id','restore-test','data',jsonb_build_object('encrypted','lcb-e2ee-v1'))),
      'lcb_private_keys',jsonb_build_array(
        jsonb_build_object('user_id','carol','salt','new','private_iv','new','private_cipher','backup-carol'),
        jsonb_build_object('user_id','benson','salt','new','private_iv','new','private_cipher','backup-benson')),
      'lcb_matter_keys',jsonb_build_array(
        jsonb_build_object('matter_id','restore-test','user_id','carol','wrapped_key','wrapped-carol'),
        jsonb_build_object('matter_id','restore-test','user_id','benson','wrapped_key','wrapped-benson')));
    perform public.lcb_restore_encrypted_backup(payload);
    if (select count(*) from public.lcb_matter_keys where matter_id='restore-test')<>2 then
      raise exception 'FAIL: % restore omitted another user matter key',caller;
    end if;
    if (select private_cipher from public.lcb_private_keys where user_id=caller)<>'backup-'||caller then
      raise exception 'FAIL: caller private key not restored';
    end if;
    if (select private_cipher from public.lcb_private_keys where user_id=other_user)<>'original-'||other_user then
      raise exception 'FAIL: other account private key changed';
    end if;
    perform public.lcb_restore_encrypted_backup(payload);
    if (select count(*) from public.lcb_matter_keys where matter_id='restore-test')<>2 then
      raise exception 'FAIL: repeated restore was not idempotent';
    end if;
  end loop;
  perform set_config('test.app_user','',true);
  begin
    perform public.lcb_restore_encrypted_backup('{}');
    raise exception 'FAIL: anonymous restore accepted';
  exception when others then
    if sqlerrm<>'admin required' then raise; end if;
  end;
end $$;
rollback;
