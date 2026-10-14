-- Disposable LOCAL database only; no production fixtures.
begin;
do $$
declare result jsonb; uid text;
begin
 perform set_config('test.app_user','carol',true);
 perform public.carol_patch_user_preferences('{"hidden":["#/matters"],"future":{"density":"compact"}}');
 perform public.carol_patch_user_preferences('{"theme":{"r":255,"g":0,"b":0,"s":100}}');
 result:=public.carol_get_user_preferences();
 if result->'hidden' is distinct from '["#/matters"]'::jsonb or result->'future'->>'density' is distinct from 'compact' then raise exception 'FAIL: unrelated settings lost'; end if;
 perform set_config('test.app_user','benson',true);
 if public.carol_get_user_preferences() is distinct from '{}'::jsonb then raise exception 'FAIL: account data leaked'; end if;
 perform public.carol_patch_user_preferences('{"theme":null,"user_id":"carol"}');
 perform set_config('test.app_user','carol',true);
 if public.carol_get_user_preferences() is distinct from result then raise exception 'FAIL: another account overwritten'; end if;
 perform public.carol_patch_user_preferences('{"theme":null}');
 if public.carol_get_user_preferences()->'theme' is distinct from 'null'::jsonb then raise exception 'FAIL: theme reset failed'; end if;
 if public.carol_get_user_preferences()->'future'->>'density' is distinct from 'compact' then raise exception 'FAIL: future setting lost after reset'; end if;
 perform public.lcb_set_user_preferences('{"hidden":[]}');
 if public.carol_get_user_preferences()->'future'->>'density' is distinct from 'compact' then raise exception 'FAIL: old client erased future setting'; end if;
 perform set_config('test.app_user','',true);
 begin
  perform public.carol_patch_user_preferences('{}');
  raise exception 'FAIL: unauthenticated write';
 exception when others then if sqlerrm<>'authentication required' then raise; end if; end;
 begin
  perform public.carol_get_user_preferences();
  raise exception 'FAIL: unauthenticated read';
 exception when others then if sqlerrm<>'authentication required' then raise; end if; end;
 if has_function_privilege('anon','public.carol_patch_user_preferences(jsonb)','EXECUTE') then raise exception 'FAIL: anonymous execute granted'; end if;
end $$;
rollback;
