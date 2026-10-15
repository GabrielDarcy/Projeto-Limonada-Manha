-- ==============================================================================
-- Migração: Suporte a Login Híbrido por E-mail ou Nome de Usuário (Username)
-- Onde rodar: Painel do Supabase -> SQL Editor -> New query -> Colar -> Run
-- ==============================================================================
--
-- Contexto:
-- O método nativo supabase.auth.signInWithPassword({ email, password }) exige
-- um e-mail válido. Para permitir login pelo "username" (com ou sem '@'),
-- criamos a função get_email_by_username() com SECURITY DEFINER para que usuários
-- ainda não autenticados (anon) consigam resolver o username para o e-mail
-- correspondente sem serem bloqueados pelas regras de RLS da tabela profiles.
--

-- 1. Cria ou substitui a função RPC para busca segura de e-mail por username
create or replace function public.get_email_by_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_clean text;
begin
  -- Normaliza o username: remove espaços, remove arroba inicial e converte para minúsculas
  v_clean := lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', '')));

  if v_clean = '' then
    return null;
  end if;

  -- 1.1 Tenta buscar diretamente pelo email cadastrado na tabela de perfis
  select p.email into v_email
  from public.profiles p
  where lower(p.username) = v_clean
    and p.email is not null
    and trim(p.email) <> ''
  limit 1;

  -- 1.2 Se a coluna profiles.email estiver nula, busca o email do auth.users usando o id do profile
  if v_email is null then
    select u.email into v_email
    from public.profiles p
    join auth.users u on u.id = p.id
    where lower(p.username) = v_clean
    limit 1;
  end if;

  return v_email;
end;
$$;

-- 2. Concede permissão de execução da função para anon, authenticated e service_role
grant execute on function public.get_email_by_username(text) to anon, authenticated, service_role;

-- 3. Cria índice na coluna username em lower() para garantir buscas instantâneas
create index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- 4. Comentário explicativo na função para documentação do esquema
comment on function public.get_email_by_username(text) is
  'Permite ao fluxo de autenticação resolver com segurança um username para o respectivo e-mail cadastrado, contornando restrições de RLS antes do login.';
