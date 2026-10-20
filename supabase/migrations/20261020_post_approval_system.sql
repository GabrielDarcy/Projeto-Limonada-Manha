-- ==============================================================================
-- SISTEMA DE APROVAÇÃO PRÉVIA DE PUBLICAÇÕES (MODERAÇÃO ADMINISTRATIVA)
-- Data: 2026-10-20
-- Migração idempotente para controle de moderação de posts e aprovação por admin.
-- ==============================================================================

-- 1. Tabela de configurações do sistema com RLS
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

comment on table public.system_settings is 'Parâmetros e flags operacionais globais do sistema Pet Amor.';

-- Garante o registro padrão de require_post_approval = false
insert into public.system_settings (key, value)
values ('require_post_approval', 'false'::jsonb)
on conflict (key) do nothing;

-- 2. Habilitação universal de Row Level Security em system_settings
alter table public.system_settings enable row level security;
alter table public.system_settings force row level security;

-- Política de leitura: Qualquer visitante/usuário pode ler configurações públicas operacionais
drop policy if exists "Configuracoes visiveis publicamente" on public.system_settings;
create policy "Configuracoes visiveis publicamente"
  on public.system_settings for select
  using (true);

-- Política de mutação: Apenas administradores autenticados e ativos podem alterar configurações
drop policy if exists "Apenas admin modifica configuracoes" on public.system_settings;
create policy "Apenas admin modifica configuracoes"
  on public.system_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3. Atualização das restrições de status na tabela public.posts
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('active', 'in_process', 'adopted', 'banned', 'pending', 'rejected'));

comment on column public.posts.status is 'Estado do post: active (ativo/público), in_process (em entrevista), adopted (adotado), banned (banido), pending (aguardando moderação), rejected (recusado pela moderação)';

-- Criação de índice otimizado para consultas de moderação
create index if not exists posts_pending_approval_idx
  on public.posts (status, created_at desc)
  where status = 'pending';

-- 4. Atualização das políticas RLS da tabela public.posts
-- SELECT: Posts ativos, em processo ou adotados são públicos. Posts pendentes ou rejeitados só são visíveis pelo autor ou admin.
drop policy if exists "Posts ativos são públicos" on public.posts;
create policy "Posts ativos são públicos"
  on public.posts for select
  using (
    status in ('active', 'in_process', 'adopted')
    or auth.uid() = user_id
    or public.is_admin()
  );

-- INSERT: Usuários autenticados criam posts (permitido 'active' ou 'pending', o trigger força conforme configuração)
drop policy if exists "Usuário autenticado cria seus próprios posts" on public.posts;
create policy "Usuário autenticado cria seus próprios posts"
  on public.posts for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and status in ('active', 'pending')
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and status <> 'banned'
    )
  );

-- UPDATE: Autor ou admin atualiza posts (o trigger de integridade impede auto-aprovação de status por não-admins)
drop policy if exists "Autor ou admin atualiza posts" on public.posts;
create policy "Autor ou admin atualiza posts"
  on public.posts for update
  to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- 5. Trigger de Blindagem de Integridade e Moderação (Anti-Bypass / Anti-Privilege-Escalation)
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
  -- Identifica se o executor da transação é um administrador
  v_is_adm := public.is_admin();

  -- Consulta flag global no system_settings
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

  -- OPERAÇÃO DE INSERT
  if tg_op = 'INSERT' then
    if not v_is_adm then
      -- Se a moderação estiver ativa, força sem exceção o status para 'pending'
      if v_require_approval then
        new.status := 'pending';
      else
        -- Se não estiver ativa, não permite criar com status privilegiados (banned/rejected)
        if new.status not in ('active', 'pending') then
          new.status := 'active';
        end if;
      end if;
    end if;
    return new;
  end if;

  -- OPERAÇÃO DE UPDATE
  if tg_op = 'UPDATE' then
    if not v_is_adm then
      -- Não-administrador não pode alterar status se o post estiver pendente ou recusado
      if old.status in ('pending', 'rejected') and new.status <> old.status then
        raise exception 'Apenas administradores podem moderar ou aprovar publicações pendentes/recusadas.';
      end if;

      -- Não-administrador não pode auto-aprovar ou aplicar status reservados
      if new.status in ('banned', 'rejected') then
        raise exception 'Operação não autorizada para status reservado.';
      end if;

      -- Se o post já era ativo/em processo/adotado, autor pode transitar apenas entre esses 3 estados
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

-- 6. RPC: Alterar modo de aprovação prévia com validação de admin e search_path seguro
create or replace function public.admin_set_post_approval_mode(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_updated_at timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'Acesso negado: apenas administradores podem configurar o modo de moderação.';
  end if;

  insert into public.system_settings (key, value, updated_at, updated_by)
  values ('require_post_approval', to_jsonb(p_enabled), v_updated_at, auth.uid())
  on conflict (key) do update set
    value = to_jsonb(p_enabled),
    updated_at = v_updated_at,
    updated_by = auth.uid();

  return jsonb_build_object(
    'success', true,
    'require_post_approval', p_enabled,
    'updated_at', v_updated_at
  );
end;
$$;

-- 7. RPC: Moderar publicação (Aprovar ou Recusar) com validação de admin
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

-- Revoga permissões diretas de anon e concede apenas authenticated para RPCs
revoke all on function public.admin_set_post_approval_mode(boolean) from public, anon;
grant execute on function public.admin_set_post_approval_mode(boolean) to authenticated;

revoke all on function public.admin_moderate_post(uuid, text) from public, anon;
grant execute on function public.admin_moderate_post(uuid, text) to authenticated;
