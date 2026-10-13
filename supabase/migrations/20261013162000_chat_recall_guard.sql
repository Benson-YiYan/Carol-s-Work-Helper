create or replace function public.lcb_protect_log_updates() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  actor text := public.lcb_app_user_id();
  old_recalled_at bigint := nullif(old.data->>'recalledAt','')::bigint;
  new_recalled_at bigint := nullif(new.data->>'recalledAt','')::bigint;
begin
  if (old.data - array['readBy','deletedFor','recalledAt','recalledBy'])
     is distinct from
     (new.data - array['readBy','deletedFor','recalledAt','recalledBy']) then
    raise exception 'log content is immutable';
  end if;

  if old_recalled_at is not null and
     (new_recalled_at is distinct from old_recalled_at or new.data->>'recalledBy' is distinct from old.data->>'recalledBy') then
    raise exception 'recalled message is immutable';
  end if;

  if old_recalled_at is null and new_recalled_at is not null then
    if actor is null or actor <> old.data->>'by' or new.data->>'recalledBy' <> actor then
      raise exception 'only the message author may recall it';
    end if;
    if new_recalled_at < (old.data->>'at')::bigint or new_recalled_at > (old.data->>'at')::bigint + 300000 then
      raise exception 'message recall window expired';
    end if;
    if extract(epoch from clock_timestamp()) * 1000 > (old.data->>'at')::bigint + 300000 then
      raise exception 'message recall window expired';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lcb_protect_log_updates on public.logs;
create trigger lcb_protect_log_updates before update on public.logs
for each row execute function public.lcb_protect_log_updates();
