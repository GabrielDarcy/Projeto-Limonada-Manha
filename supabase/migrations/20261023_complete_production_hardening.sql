alter table public.posts
  add column if not exists views_count integer not null default 0;

comment on column public.posts.views_count is 'Contador atômico de visualizações únicas por publicação.';

create table if not exists public.api_rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.api_rate_limits enable row level security;
alter table public.api_rate_limits force row level security;

drop policy if exists "Rate limits restrito a admin" on public.api_rate_limits;
create policy "Rate limits restrito a admin"
  on public.api_rate_limits for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists api_rate_limits_user_action_idx
  on public.api_rate_limits (user_id, action, created_at desc);

create or replace function public.check_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_actions integer,
  p_window_interval interval
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  if p_user_id is null then
    return true;
  end if;

  delete from public.api_rate_limits
  where created_at < (now() - interval '1 day');

  select count(*) into v_count
  from public.api_rate_limits
  where user_id = p_user_id
    and action = p_action
    and created_at > (now() - p_window_interval);

  if v_count >= p_max_actions then
    return false;
  end if;

  insert into public.api_rate_limits (user_id, action, created_at)
  values (p_user_id, p_action, now());

  return true;
end;
$$;

create or replace function public.trg_enforce_post_moderation_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_require_approval boolean := false;
  v_is_adm boolean := false;
  v_setting_val jsonb;
begin
  v_is_adm := public.is_admin();

  select value into v_setting_val
  from public.system_settings
  where key = 'require_post_approval';

  if v_setting_val is not null then
    if jsonb_typeof(v_setting_val) = 'boolean' then
      v_require_approval := (v_setting_val)::text = 'true';
    else
      v_require_approval := (v_setting_val #>> '{}') in ('true', '1');
    end if;
  end if;

  if tg_op = 'INSERT' then
    if not v_is_adm then
      if not public.check_rate_limit(new.user_id, 'create_post', 10, interval '10 minutes') then
        raise exception 'Limite de publicações atingido. Por favor, aguarde alguns minutos antes de criar novos anúncios.';
      end if;

      if v_require_approval then
        new.status := 'pending';
      else
        if new.status not in ('active', 'pending') then
          new.status := 'active';
        end if;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not v_is_adm then

      if old.status = 'banned' then
        raise exception 'Esta publicação foi banida pela moderação e não pode ser alterada.';
      end if;

      if old.status in ('pending', 'rejected') and new.status <> old.status then
        raise exception 'Apenas administradores podem moderar ou aprovar publicações pendentes/recusadas.';
      end if;

      if new.status in ('banned', 'rejected') then
        raise exception 'Operação não autorizada para status reservado de moderação.';
      end if;

      if old.status in ('active', 'in_process', 'adopted') and new.status not in ('active', 'in_process', 'adopted') then
        raise exception 'Transição de status inválida para o autor.';
      end if;
    end if;

    new.updated_at := now();
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_posts_moderation_check on public.posts;
create trigger trg_posts_moderation_check
  before insert or update on public.posts
  for each row
  execute function public.trg_enforce_post_moderation_rules();

create or replace function public.increment_post_views(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.posts
  set views_count = coalesce(views_count, 0) + 1
  where id = p_post_id
    and status in ('active', 'in_process', 'adopted');
end;
$$;

grant execute on function public.increment_post_views(uuid) to anon, authenticated, service_role;
revoke all on function public.check_rate_limit(uuid, text, integer, interval) from public, anon;

notify pgrst, 'reload schema';
