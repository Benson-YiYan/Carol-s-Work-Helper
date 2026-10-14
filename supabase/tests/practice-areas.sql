-- Only run in an isolated disposable database. All fixtures roll back.
begin;
do $$
declare rows jsonb; result jsonb; snap jsonb; original jsonb;
begin
 if to_regprocedure('public.carol_mutate_practice_area(jsonb)') is null then raise exception 'FAIL: practice area RPC missing'; end if;
 perform set_config('test.app_user','',true);
 begin perform public.carol_get_practice_areas(); raise exception 'FAIL: anonymous read'; exception when others then if sqlerrm<>'authentication required' then raise; end if; end;
 perform set_config('test.app_user','benson',true);
 perform public.carol_mutate_practice_area('{"action":"create","id":"custom_test","name":{"zh":"测试","en":"Test","es":"Prueba"},"members":["benson"]}');
 if not exists(select 1 from public.carol_practice_areas where id='custom_test') then raise exception 'FAIL: member creation denied'; end if;
 
 perform set_config('test.app_user','carol',true);
 perform public.carol_mutate_practice_area('{"action":"member","id":"custom_test","user":"carol","enabled":true}');
 if not (select members ? 'carol' and members ? 'benson' from public.carol_practice_areas where id='custom_test') then raise exception 'FAIL: member patch erased other member'; end if;
 insert into public.matters(id,data,updated_at) values('fixture', '{"encrypted":"lcb-e2ee-v1","owner":"carol"}', '2026-01-01Z');
 original:=(select data from public.matters where id='fixture');
 snap:='[{"id":"fixture","area":"custom_test","kind":"","updated_at":"2026-01-01T00:00:00Z"}]';
 result:=public.carol_mutate_practice_area(jsonb_build_object('action','delete','id','custom_test','snapshot',snap));
 if result->'blocked' <> '["fixture"]'::jsonb then raise exception 'FAIL: encrypted usage did not block deletion'; end if;
 if (select deleted from public.carol_practice_areas where id='custom_test') then raise exception 'FAIL: used area deleted'; end if;
 begin
  perform public.carol_mutate_practice_area('{"action":"delete","id":"custom_test","snapshot":[]}');
  raise exception 'FAIL: incomplete snapshot accepted';
 exception when others then if sqlerrm<>'stale matter snapshot' then raise; end if; end;
 update public.matters set updated_at='2026-01-02Z' where id='fixture';
 begin
  perform public.carol_mutate_practice_area(jsonb_build_object('action','delete','id','custom_test','snapshot',snap));
  raise exception 'FAIL: stale snapshot accepted';
 exception when others then if sqlerrm<>'stale matter snapshot' then raise; end if; end;
 snap:='[{"id":"fixture","area":"other","kind":"","updated_at":"2026-01-02T00:00:00Z"}]';
 perform set_config('test.app_user','benson',true);
 result:=public.carol_mutate_practice_area(jsonb_build_object('action','delete','id','custom_test','snapshot',snap));
 if not (select deleted from public.carol_practice_areas where id='custom_test') then raise exception 'FAIL: unused area not deleted'; end if;
 if (select data from public.matters where id='fixture') is distinct from original then raise exception 'FAIL: business data modified'; end if;
 if has_function_privilege('anon','public.carol_mutate_practice_area(jsonb)','execute') then raise exception 'FAIL: anonymous execute grant'; end if;
 if has_table_privilege('authenticated','public.carol_practice_areas','insert') then raise exception 'FAIL: direct table writes'; end if;
end $$;
do $$
declare snap jsonb; result jsonb; illegal text:='carlos';
begin
 perform set_config('test.app_user','carol',true);
 begin
  perform public.carol_mutate_practice_area(jsonb_build_object('action','create','id','custom_invalid','name','{"zh":"X","en":"X","es":"X"}'::jsonb,'members',jsonb_build_array(illegal)));
  raise exception 'FAIL: other site user accepted';
 exception when others then if sqlerrm<>'invalid members' then raise; end if; end;
 perform public.carol_mutate_practice_area('{"action":"create","id":"custom_plain","name":{"zh":"Plain","en":"Plain","es":"Plain"},"members":[]}');
 insert into public.matters(id,data,updated_at) values('plain-fixture','{"area":"custom_plain","title":"Private","deletedAt":1}', '2026-01-02Z');
 snap:='[{"id":"fixture","area":"other","kind":"","updated_at":"2026-01-02T00:00:00Z"},{"id":"plain-fixture","area":"forged-other","kind":"client","updated_at":"2026-01-02T00:00:00Z"}]';
 result:=public.carol_mutate_practice_area(jsonb_build_object('action','delete','id','custom_plain','snapshot',snap));
 if result->'blocked'<>'["plain-fixture"]'::jsonb then raise exception 'FAIL: plaintext usage trusted forged snapshot or ignored recycle bin'; end if;
 if to_regprocedure('public.lcb_get_practice_areas()') is not null then raise exception 'FAIL: other site function in isolated database'; end if;
end $$;
rollback;

