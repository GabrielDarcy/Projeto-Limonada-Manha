create or replace function public.auto_confirm_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  -- se o e-mail não tiver data de confirmação confirma imediatamente
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  if new.confirmed_at is null then
    new.confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_confirm_new_user on auth.users;
create trigger trg_auto_confirm_new_user
  before insert on auth.users
  for each row
  execute function public.auto_confirm_new_user();

update auth.users
set email_confirmed_at = now(),
    confirmed_at = now()
where email_confirmed_at is null;

