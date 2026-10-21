
-- garante a coluna updated_at na tabela public.posts
alter table public.posts
  add column if not exists updated_at timestamptz not null default now();

comment on column public.posts.updated_at is 'Timestamp da última modificação do registro da publicação.';


alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('active', 'in_process', 'adopted', 'banned', 'pending', 'rejected'));

alter table public.posts enable row level security;
alter table public.posts force row level security;

drop policy if exists "Posts ativos são públicos" on public.posts;
create policy "Posts ativos são públicos"
  on public.posts for select
  using (
    status in ('active', 'in_process', 'adopted')
    or auth.uid() = user_id
    or public.is_admin()
  );

drop policy if exists "Autor ou admin atualiza posts" on public.posts;
create policy "Autor ou admin atualiza posts"
  on public.posts for update
  to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- trigger anti-bypass de moderação no banco
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
      if old.status in ('pending', 'rejected') and new.status <> old.status then
        raise exception 'Apenas administradores podem moderar ou aprovar publicações pendentes/recusadas.';
      end if;

      if new.status in ('banned', 'rejected') then
        raise exception 'Operação não autorizada para status reservado.';
      end if;

      if old.status in ('active', 'in_process', 'adopted') and new.status not in ('active', 'in_process', 'adopted') then
        raise exception 'Transição de status inválida para o autor.';
      end if;
    end if;
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

-- função RPC segura para moderação administrativa
create or replace function public.admin_moderate_post(
  p_post_id uuid,
  p_action text -- 'approve' ou 'reject'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_new_status text;
  v_post record;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado: apenas administradores podem moderar publicações.';
  end if;

  if p_action = 'approve' then
    v_new_status := 'active';
  elsif p_action = 'reject' then
    v_new_status := 'rejected';
  else
    raise exception 'Ação de moderação inválida. Utilize "approve" ou "reject".';
  end if;


  select id, title, user_id, status into v_post
  from public.posts
  where id = p_post_id;

  if not found then
    raise exception 'Publicação não encontrada.';
  end if;


  update public.posts
  set status = v_new_status,
      updated_at = now()
  where id = p_post_id;

  return jsonb_build_object(
    'success', true,
    'post_id', p_post_id,
    'new_status', v_new_status,
    'title', v_post.title
  );
end;
$$;

revoke all on function public.admin_moderate_post(uuid, text) from public, anon;
grant execute on function public.admin_moderate_post(uuid, text) to authenticated;

notify pgrst, 'reload schema';
