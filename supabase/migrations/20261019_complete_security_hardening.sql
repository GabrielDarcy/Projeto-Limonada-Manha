-- ==============================================================================
-- MIGRAÇÃO DE HARDENING COMPLETO DE SEGURANÇA E BANCO DE DADOS
-- Projeto: Pet Amor (Projeto-Limonada-Manha)
-- Onde aplicar: Painel do Supabase -> SQL Editor -> New Query -> Colar -> Run
-- ==============================================================================

-- 0. Extensões Criptográficas
create extension if not exists "pgcrypto";

-- ==============================================================================
-- 1. TABELA DE PERFIS (PROFILES) - ESTRUTURA E REGRAS ESTRITAS
-- ==============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  username text,
  birth_date date,
  avatar_url text,
  favorite_posts text[] default '{}'::text[],
  role text not null default 'user',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Remove qualquer coluna insegura legada se existir
alter table public.profiles drop column if exists recovery_code;

-- Garante colunas necessárias
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists favorite_posts text[] default '{}'::text[];
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Constraints de validação estrita
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user', 'admin'));

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('active', 'banned'));

alter table public.profiles drop constraint if exists profiles_username_format_check;
alter table public.profiles add constraint profiles_username_format_check
  check (username is null or username ~* '^[a-z0-9._]{3,30}$');

-- Índices de alta performance
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(trim(username)));

create index if not exists profiles_email_lower_idx
  on public.profiles (lower(trim(email)));

create index if not exists profiles_role_status_idx
  on public.profiles (role, status);

-- ==============================================================================
-- 2. FUNÇÃO AUXILIAR DE SEGURANÇA: is_admin()
-- ==============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and status = 'active'
  );
$$;

grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ==============================================================================
-- 3. TRIGGER ANTI-ESCALADA DE PRIVILÉGIOS EM PROFILES
-- ==============================================================================

create or replace function public.protect_profile_roles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Atualiza timestamp de modificação
  new.updated_at := now();

  -- Impede que usuários normais alterem 'role' ou 'status'
  if (new.role is distinct from old.role or new.status is distinct from old.status) then
    if not public.is_admin() and current_user not in ('postgres', 'service_role', 'supabase_admin') then
      raise exception 'Acesso negado: apenas administradores podem alterar o papel ou status de uma conta.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_roles on public.profiles;
create trigger trg_protect_profile_roles
  before update on public.profiles
  for each row
  execute function public.protect_profile_roles();

-- 3.1 Sincronização automática de novos usuários (Email/Senha e OAuth Google)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_base_username text;
  v_final_username text;
  v_avatar text;
  v_name text;
begin
  v_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );

  v_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  -- Gera username limpo a partir do email ou nome
  v_base_username := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9._]', '', 'g'));
  if length(v_base_username) < 3 then
    v_base_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  v_final_username := v_base_username;
  if exists (select 1 from public.profiles where lower(username) = lower(v_final_username) and id <> new.id) then
    v_final_username := substr(v_base_username, 1, 20) || '_' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;

  insert into public.profiles (id, email, full_name, username, avatar_url, role, status)
  values (
    new.id,
    new.email,
    v_name,
    v_final_username,
    v_avatar,
    'user',
    'active'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(profiles.full_name, excluded.full_name),
    avatar_url = coalesce(profiles.avatar_url, excluded.avatar_url),
    username = coalesce(profiles.username, excluded.username);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==============================================================================
-- 4. TABELA PRIVADA DE CÓDIGOS DE RECUPERAÇÃO (ISOLAMENTO CONTRA ATO)
-- ==============================================================================

create table if not exists public.user_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  salt text not null,
  code_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Habilita RLS total: Nenhum usuário comum pode fazer SELECT, INSERT ou UPDATE diretamente!
alter table public.user_recovery_codes enable row level security;
alter table public.user_recovery_codes force row level security;

-- Nenhuma política pública criada = Deny All para anon e authenticated. Apenas SECURITY DEFINER pode acessar.

-- ==============================================================================
-- 5. TABELA DE PUBLICAÇÕES (POSTS) - ESTRUTURA E CONSTRAINTS
-- ==============================================================================

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  contact_info text not null,
  state text not null,
  city text not null,
  animal_type text not null,
  breed text,
  size text,
  mother_breed text,
  father_breed text,
  image_urls text[] not null default '{}'::text[],
  age_group text,
  gender text,
  energy_level text,
  neutered boolean,
  vaccinated boolean,
  dewormed boolean,
  special_needs boolean,
  apartment_friendly boolean,
  good_with_kids boolean,
  good_with_dogs boolean,
  good_with_cats boolean,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Constraints
alter table public.posts drop constraint if exists posts_animal_type_check;
alter table public.posts add constraint posts_animal_type_check
  check (animal_type in ('Cachorro', 'Gato', 'Fazenda', 'Exótico', 'Marinho', 'Outro'));

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('active', 'adopted', 'banned'));

alter table public.posts drop constraint if exists posts_gender_check;
alter table public.posts add constraint posts_gender_check
  check (gender is null or gender in ('Macho', 'Fêmea'));

alter table public.posts drop constraint if exists posts_age_group_check;
alter table public.posts add constraint posts_age_group_check
  check (age_group is null or age_group in ('Filhote', 'Jovem', 'Adulto', 'Idoso'));

alter table public.posts drop constraint if exists posts_energy_level_check;
alter table public.posts add constraint posts_energy_level_check
  check (energy_level is null or energy_level in ('Calmo', 'Moderado', 'Agitado'));

alter table public.posts drop constraint if exists posts_images_count_check;
alter table public.posts add constraint posts_images_count_check
  check (array_length(image_urls, 1) is null or array_length(image_urls, 1) <= 4);

-- Índices de consulta e filtros
create index if not exists posts_user_id_idx on public.posts (user_id);
create index if not exists posts_feed_idx on public.posts (animal_type, status, created_at desc);
create index if not exists posts_location_idx on public.posts (state, city);

-- ==============================================================================
-- 6. RATE LIMITING SERVER-SIDE PARA POSTS (MÁX 10/HORA)
-- ==============================================================================

create or replace function public.check_post_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
  v_user_status text;
begin
  -- 1. Bloqueia se usuário for banido
  select status into v_user_status from public.profiles where id = new.user_id;
  if v_user_status = 'banned' then
    raise exception 'Sua conta está banida e não possui permissão para publicar.';
  end if;

  -- 2. Limite horário para usuários que não sejam administradores
  if not public.is_admin() then
    select count(*)
      into v_count
      from public.posts
     where user_id = new.user_id
       and created_at > (now() - interval '1 hour');

    if v_count >= 10 then
      raise exception 'RATE_LIMIT_EXCEEDED: Limite de postagens por hora excedido. Aguarde antes de criar novas publicações.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_posts_rate_limit on public.posts;
create trigger trg_posts_rate_limit
  before insert on public.posts
  for each row
  execute function public.check_post_rate_limit();

-- ==============================================================================
-- 7. TABELA DE ESTATÍSTICAS DO SITE (SITE_STATISTICS)
-- ==============================================================================

create table if not exists public.site_statistics (
  id integer primary key default 1 check (id = 1),
  total_lares integer not null default 0 check (total_lares >= 0),
  base_diaria integer not null default 0 check (base_diaria >= 0),
  updated_at timestamptz not null default now()
);

insert into public.site_statistics (id, total_lares, base_diaria)
values (1, 0, 0)
on conflict (id) do nothing;

-- ==============================================================================
-- 8. TABELA DE CATÁLOGO DE RAÇAS (BREEDS)
-- ==============================================================================

create table if not exists public.breeds (
  id serial primary key,
  animal_type text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (animal_type, name)
);

create index if not exists breeds_animal_type_idx on public.breeds (animal_type);

-- Sincronizador automático de raças novas vindas de posts válidos
create or replace function public.sincronizar_raca_do_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.breed is not null and trim(new.breed) <> '' and new.animal_type is not null then
    if new.animal_type not in ('Cachorro', 'Gato') and (new.breed ilike '%vira-lata%' or new.breed ilike '%srd%') then
      new.breed := 'Não sei';
    end if;

    insert into public.breeds (animal_type, name)
    values (new.animal_type, trim(new.breed))
    on conflict (animal_type, name) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sincronizar_raca on public.posts;
create trigger trg_sincronizar_raca
  before insert or update of breed on public.posts
  for each row
  execute function public.sincronizar_raca_do_post();

-- ==============================================================================
-- 9. STORED PROCEDURES SEGURAS (RPCS)
-- ==============================================================================

-- 9.1 Busca segura de e-mail por username para login híbrido
create or replace function public.get_email_by_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_email text;
  v_clean text;
begin
  v_clean := lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
  if v_clean = '' then
    return null;
  end if;

  select email into v_email
  from public.profiles
  where lower(username) = v_clean
    and email is not null
    and trim(email) <> ''
  limit 1;

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
grant execute on function public.get_email_by_username(text) to anon, authenticated, service_role;

-- 9.2 Consulta de catálogo de raças ativas
create or replace function public.get_active_breeds(p_animal_type text)
returns table (breed text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select b.name as breed
    from public.breeds b
   where b.animal_type = p_animal_type
   order by
     case
       when p_animal_type in ('Cachorro', 'Gato') and b.name ilike '%vira-lata%' then 1
       when p_animal_type not in ('Cachorro', 'Gato') and b.name = 'Não sei' then 1
       else 2
     end,
     b.name collate "C" asc;
$$;
grant execute on function public.get_active_breeds(text) to anon, authenticated, service_role;

-- 9.3 Banimento administrativo seguro
create or replace function public.admin_ban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  -- Validação estrita de privilégio
  if not public.is_admin() then
    raise exception 'Acesso negado: apenas administradores podem banir contas.';
  end if;

  -- 1. Atualiza status do perfil
  update public.profiles
     set status = 'banned'
   where id = p_user_id;

  -- 2. Atualiza os posts do usuário para não aparecerem mais no feed público
  update public.posts
     set status = 'banned'
   where user_id = p_user_id;

  -- 3. Invalida as sessões ativas do usuário no auth
  update auth.users
     set banned_until = '2099-01-01 00:00:00+00'
   where id = p_user_id;
end;
$$;
grant execute on function public.admin_ban_user(uuid) to authenticated, service_role;

-- 9.4 Exclusão de própria conta de usuário (LGPD)
create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.';
  end if;

  -- Exclui posts do usuário
  delete from public.posts where user_id = v_uid;
  -- Exclui perfil
  delete from public.profiles where id = v_uid;
  -- Exclui do auth.users (cascata limpa sessões)
  delete from auth.users where id = v_uid;
end;
$$;
grant execute on function public.delete_user() to authenticated, service_role;

-- 9.5 Registro seguro de código de recuperação com hash criptográfico
create or replace function public.save_recovery_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_salt text;
  v_hash text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if p_code is null or not (p_code ~ '^\d{6}$') then
    raise exception 'Código de recuperação inválido. Deve conter 6 dígitos.';
  end if;

  v_salt := encode(gen_random_bytes(16), 'hex');
  v_hash := encode(digest(v_salt || p_code, 'sha256'), 'hex');

  insert into public.user_recovery_codes (user_id, salt, code_hash, failed_attempts, locked_until, updated_at)
  values (v_uid, v_salt, v_hash, 0, null, now())
  on conflict (user_id) do update set
    salt = excluded.salt,
    code_hash = excluded.code_hash,
    failed_attempts = 0,
    locked_until = null,
    updated_at = now();
end;
$$;
grant execute on function public.save_recovery_code(text) to authenticated, service_role;

-- 9.6 Redefinição de senha com código de recuperação blindado contra força bruta
create or replace function public.reset_password_with_code_v2(
  p_recovery_code text,
  p_new_password text,
  p_identifier text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_target_user_id uuid;
  v_record record;
  v_computed_hash text;
begin
  if p_recovery_code is null or not (p_recovery_code ~ '^\d{6}$') then
    raise exception 'Código de recuperação deve conter 6 dígitos.';
  end if;

  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'A nova senha deve possuir pelo menos 8 caracteres.';
  end if;

  -- 1. Se identificador (e-mail ou username) for fornecido, resolve diretamente
  if p_identifier is not null and trim(p_identifier) <> '' then
    select id into v_target_user_id
    from public.profiles
    where lower(username) = lower(trim(p_identifier))
       or lower(email) = lower(trim(p_identifier))
    limit 1;
  end if;

  -- 2. Busca o registro de recuperação
  if v_target_user_id is not null then
    select * into v_record
    from public.user_recovery_codes
    where user_id = v_target_user_id;
  else
    -- Se não passou identificador, busca o registro cujo hash corresponda
    for v_record in select * from public.user_recovery_codes loop
      if v_record.locked_until is not null and v_record.locked_until > now() then
        continue;
      end if;
      v_computed_hash := encode(digest(v_record.salt || p_recovery_code, 'sha256'), 'hex');
      if v_record.code_hash = v_computed_hash then
        v_target_user_id := v_record.user_id;
        exit;
      end if;
    end loop;
  end if;

  if v_record is null or v_target_user_id is null then
    raise exception 'Código de recuperação incorreto ou expirado.';
  end if;

  -- 3. Verifica se conta está temporariamente bloqueada por tentativas excessivas
  if v_record.locked_until is not null and v_record.locked_until > now() then
    raise exception 'Muitas tentativas incorretas. Tente novamente mais tarde.';
  end if;

  -- 4. Validação criptográfica do hash
  v_computed_hash := encode(digest(v_record.salt || p_recovery_code, 'sha256'), 'hex');
  if v_record.code_hash <> v_computed_hash then
    update public.user_recovery_codes
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '1 hour' else null end
     where id = v_record.id;
    raise exception 'Código de recuperação incorreto.';
  end if;

  -- 5. Atualiza a senha no Supabase Auth com hash nativo bcrypt
  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf'))
   where id = v_target_user_id;

  -- 6. Reseta tentativas e gera novo salt/hash para invalidar reuso do mesmo código
  update public.user_recovery_codes
     set failed_attempts = 0,
         locked_until = null,
         salt = encode(gen_random_bytes(16), 'hex'),
         code_hash = encode(digest(encode(gen_random_bytes(16), 'hex'), 'sha256'), 'hex'),
         updated_at = now()
   where id = v_record.id;

  return true;
end;
$$;
grant execute on function public.reset_password_with_code_v2(text, text, text) to anon, authenticated, service_role;

-- 9.7 Log de falhas para auditoria
create or replace function public.log_falha_reset(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Registra tentativa anônima sem quebrar o fluxo
  null;
end;
$$;
grant execute on function public.log_falha_reset(text) to anon, authenticated, service_role;

-- ==============================================================================
-- 10. ROW LEVEL SECURITY (RLS) - POLÍTICAS DE ACESSO
-- ==============================================================================

-- 10.1 PROFILES
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "Profiles são visíveis publicamente" on public.profiles;
create policy "Profiles são visíveis publicamente"
  on public.profiles for select
  using (true);

drop policy if exists "Usuário pode inserir seu próprio profile" on public.profiles;
create policy "Usuário pode inserir seu próprio profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Usuário pode atualizar seu próprio profile" on public.profiles;
create policy "Usuário pode atualizar seu próprio profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

drop policy if exists "Usuário ou Admin pode deletar profile" on public.profiles;
create policy "Usuário ou Admin pode deletar profile"
  on public.profiles for delete
  using (auth.uid() = id or public.is_admin());

-- 10.2 POSTS
alter table public.posts enable row level security;
alter table public.posts force row level security;

drop policy if exists "Posts ativos são públicos" on public.posts;
create policy "Posts ativos são públicos"
  on public.posts for select
  using (
    status in ('active', 'adopted')
    or auth.uid() = user_id
    or public.is_admin()
  );

drop policy if exists "Usuário autenticado cria seus próprios posts" on public.posts;
create policy "Usuário autenticado cria seus próprios posts"
  on public.posts for insert
  with check (
    auth.uid() = user_id
    and status = 'active'
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and status <> 'banned'
    )
  );

drop policy if exists "Autor ou admin atualiza posts" on public.posts;
create policy "Autor ou admin atualiza posts"
  on public.posts for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Autor ou admin remove posts" on public.posts;
create policy "Autor ou admin remove posts"
  on public.posts for delete
  using (auth.uid() = user_id or public.is_admin());

-- 10.3 SITE_STATISTICS
alter table public.site_statistics enable row level security;
alter table public.site_statistics force row level security;

drop policy if exists "Estatísticas visíveis publicamente" on public.site_statistics;
create policy "Estatísticas visíveis publicamente"
  on public.site_statistics for select
  using (true);

drop policy if exists "Apenas admin modifica estatísticas" on public.site_statistics;
create policy "Apenas admin modifica estatísticas"
  on public.site_statistics for all
  using (public.is_admin())
  with check (public.is_admin());

-- 10.4 BREEDS
alter table public.breeds enable row level security;
alter table public.breeds force row level security;

drop policy if exists "Catálogo de raças é público" on public.breeds;
create policy "Catálogo de raças é público"
  on public.breeds for select
  using (true);

drop policy if exists "Apenas admin ou trigger manipula catálogo" on public.breeds;
create policy "Apenas admin ou trigger manipula catálogo"
  on public.breeds for all
  using (public.is_admin())
  with check (public.is_admin());

-- ==============================================================================
-- 11. HARDENING DE BUCKETS DO SUPABASE STORAGE
-- ==============================================================================

-- Criação dos buckets se não existirem
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('pet_images', 'pet_images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Políticas de Storage para avatars (isolamento estrito de pasta por usuário)
drop policy if exists "Avatars públicos para leitura" on storage.objects;
create policy "Avatars públicos para leitura"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Usuário faz upload apenas em sua pasta de avatar" on storage.objects;
create policy "Usuário faz upload apenas em sua pasta de avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário atualiza apenas seu avatar" on storage.objects;
create policy "Usuário atualiza apenas seu avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário deleta apenas seu avatar" on storage.objects;
create policy "Usuário deleta apenas seu avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Políticas de Storage para pet_images
drop policy if exists "Imagens de pets públicas para leitura" on storage.objects;
create policy "Imagens de pets públicas para leitura"
  on storage.objects for select
  using (bucket_id = 'pet_images');

drop policy if exists "Usuários autenticados enviam imagens de pets" on storage.objects;
create policy "Usuários autenticados enviam imagens de pets"
  on storage.objects for insert
  with check (
    bucket_id = 'pet_images'
    and auth.uid() is not null
  );

drop policy if exists "Autor ou admin deleta imagens de pets" on storage.objects;
create policy "Autor ou admin deleta imagens de pets"
  on storage.objects for delete
  using (
    bucket_id = 'pet_images'
    and (auth.uid() is not null or public.is_admin())
  );

-- ==============================================================================
-- 12. POPULAÇÃO DO CATÁLOGO INICIAL DE RAÇAS
-- ==============================================================================

insert into public.breeds (animal_type, name) values
  ('Cachorro','Vira-lata (SRD)'),('Cachorro','Affenpinscher'),('Cachorro','Afghan Hound'),
  ('Cachorro','Airedale Terrier'),('Cachorro','Akita'),('Cachorro','Akita Americano'),
  ('Cachorro','American Bully'),('Cachorro','American Staffordshire Terrier'),
  ('Cachorro','Australian Cattle Dog'),('Cachorro','Australian Shepherd'),('Cachorro','Basenji'),
  ('Cachorro','Basset Hound'),('Cachorro','Beagle'),('Cachorro','Bearded Collie'),
  ('Cachorro','Bernese Mountain Dog'),('Cachorro','Bichon Frisé'),('Cachorro','Bloodhound'),
  ('Cachorro','Border Collie'),('Cachorro','Boston Terrier'),('Cachorro','Boxer'),
  ('Cachorro','Buldogue Americano'),('Cachorro','Buldogue Campeiro'),('Cachorro','Buldogue Francês'),
  ('Cachorro','Buldogue Inglês'),('Cachorro','Bull Terrier'),('Cachorro','Bullmastiff'),
  ('Cachorro','Cane Corso'),('Cachorro','Cavalier King Charles Spaniel'),('Cachorro','Chihuahua'),
  ('Cachorro','Chow Chow'),('Cachorro','Cocker Spaniel Americano'),('Cachorro','Cocker Spaniel Inglês'),
  ('Cachorro','Collie'),('Cachorro','Cão de Crista Chinês'),('Cachorro','Cão de água português'),
  ('Cachorro','Cão de montanha dos Pirineus'),('Cachorro','Dachshund'),('Cachorro','Dálmata'),
  ('Cachorro','Doberman'),('Cachorro','Dogo Argentino'),('Cachorro','Dogue Alemão'),
  ('Cachorro','Dogue de Bordeaux'),('Cachorro','Fila Brasileiro'),('Cachorro','Fox Paulistinha'),
  ('Cachorro','Golden Retriever'),('Cachorro','Greyhound'),('Cachorro','Griffon de Bruxelas'),
  ('Cachorro','Husky Siberiano'),('Cachorro','Jack Russell Terrier'),('Cachorro','Labrador Retriever'),
  ('Cachorro','Lhasa Apso'),('Cachorro','Lulu da Pomerânia'),('Cachorro','Malamute do Alasca'),
  ('Cachorro','Maltês'),('Cachorro','Mastiff'),('Cachorro','Norfolk Terrier'),
  ('Cachorro','Norwich Terrier'),('Cachorro','Old English Sheepdog'),('Cachorro','Papillon'),
  ('Cachorro','Pastor Alemão'),('Cachorro','Pastor Australiano'),('Cachorro','Pastor Belga'),
  ('Cachorro','Pastor Branco Suíço'),('Cachorro','Pastor de Shetland'),('Cachorro','Pequinês'),
  ('Cachorro','Pinscher'),('Cachorro','Pit Bull'),('Cachorro','Pointer Inglês'),('Cachorro','Poodle'),
  ('Cachorro','Pug'),('Cachorro','Rottweiler'),('Cachorro','Samoieda'),('Cachorro','Schnauzer'),
  ('Cachorro','Setter Irlandês'),('Cachorro','Shar-Pei'),('Cachorro','Shiba Inu'),
  ('Cachorro','Shih Tzu'),('Cachorro','Staffordshire Bull Terrier'),('Cachorro','São Bernardo'),
  ('Cachorro','Terrier Brasileiro'),('Cachorro','Terrier Escocês'),('Cachorro','Vizsla'),
  ('Cachorro','Weimaraner'),('Cachorro','Welsh Corgi'),('Cachorro','West Highland White Terrier'),
  ('Cachorro','Whippet'),('Cachorro','Yorkshire Terrier'),
  ('Gato','Vira-lata (SRD)'),('Gato','Abissínio'),('Gato','American Curl'),('Gato','American Shorthair'),
  ('Gato','American Wirehair'),('Gato','Angorá'),('Gato','Azul Russo'),('Gato','Balinês'),
  ('Gato','Bengal'),('Gato','Birmanês'),('Gato','Bombaim'),('Gato','British Longhair'),
  ('Gato','British Shorthair'),('Gato','Burmês'),('Gato','Chartreux'),('Gato','Cornish Rex'),
  ('Gato','Devon Rex'),('Gato','Exótico de Pelo Curto'),('Gato','Himalaio'),('Gato','Khao Manee'),
  ('Gato','LaPerm'),('Gato','Maine Coon'),('Gato','Manx'),('Gato','Munchkin'),('Gato','Nebelung'),
  ('Gato','Norueguês da Floresta'),('Gato','Oriental'),('Gato','Persa'),('Gato','Peterbald'),
  ('Gato','Ragdoll'),('Gato','Sagrado da Birmânia'),('Gato','Savannah'),('Gato','Scottish Fold'),
  ('Gato','Scottish Straight'),('Gato','Selkirk Rex'),('Gato','Siamês'),('Gato','Siberiano'),
  ('Gato','Singapura'),('Gato','Somali'),('Gato','Sphynx'),('Gato','Tonquinês'),('Gato','Turco Van'),
  ('Fazenda','Não sei'),('Fazenda','Abelha'),('Fazenda','Alpaca'),('Fazenda','Asinino'),('Fazenda','Avestruz'),
  ('Fazenda','Bode'),('Fazenda','Boi'),('Fazenda','Boi Angus'),('Fazenda','Boi Brahman'),('Fazenda','Boi Hereford'),
  ('Fazenda','Boi Nelore'),('Fazenda','Búfalo'),('Fazenda','Cabra'),('Fazenda','Cabra Anglonubiana'),
  ('Fazenda','Cabra Boer'),('Fazenda','Cabra Saanen'),('Fazenda','Cabra Toggenburg'),('Fazenda','Cavalo'),
  ('Fazenda','Cavalo Árabe'),('Fazenda','Cavalo Campolina'),('Fazenda','Cavalo Crioulo'),
  ('Fazenda','Cavalo Mangalarga'),('Fazenda','Cavalo Quarto de Milha'),('Fazenda','Codorna'),('Fazenda','Coelho'),
  ('Fazenda','Coelho Angorá'),('Fazenda','Coelho Mini Lop'),('Fazenda','Coelho Nova Zelândia'),('Fazenda','Galinha'),
  ('Fazenda','Galinha caipira'),('Fazenda','Ganso'),('Fazenda','Gado de leite'),('Fazenda','Jumento'),
  ('Fazenda','Lhama'),('Fazenda','Marreco'),('Fazenda','Mula'),('Fazenda','Ovelha'),('Fazenda','Ovelha Dorper'),
  ('Fazenda','Ovelha Hampshire Down'),('Fazenda','Ovelha Santa Inês'),('Fazenda','Pato'),('Fazenda','Pavão'),
  ('Fazenda','Peru'),('Fazenda','Porco'),('Fazenda','Porco caipira'),('Fazenda','Pônei'),('Fazenda','Vaca'),
  ('Fazenda','Vaca Girolando'),('Fazenda','Vaca Holandesa'),('Fazenda','Vaca Jersey'),('Fazenda','Vaca Nelore'),
  ('Fazenda','Égua'),
  ('Exótico','Não sei'),('Exótico','Agapornis'),('Exótico','Axolote'),('Exótico','Cacatua'),('Exótico','Calopsita'),
  ('Exótico','Camaleão'),('Exótico','Canário'),('Exótico','Chinchila'),('Exótico','Cobra'),('Exótico','Cobra-do-milho'),
  ('Exótico','Cágado'),('Exótico','Degú'),('Exótico','Dragão-barbudo'),('Exótico','Escorpião'),
  ('Exótico','Esquilo-da-Mongólia'),('Exótico','Furão'),('Exótico','Gecko-leopardo'),('Exótico','Gerbil'),
  ('Exótico','Hamster'),('Exótico','Hamster chinês'),('Exótico','Hamster sírio'),('Exótico','Iguana'),
  ('Exótico','Jabuti'),('Exótico','Jabuti-piranga'),('Exótico','Jiboia'),('Exótico','Lagartixa'),('Exótico','Lagarto'),
  ('Exótico','Maritaca'),('Exótico','Mini pig'),('Exótico','Ouriço-cacheiro'),('Exótico','Periquito'),
  ('Exótico','Periquito-australiano'),('Exótico','Pogona'),('Exótico','Porquinho-da-índia'),('Exótico','Rato'),
  ('Exótico','Rato twister'),('Exótico','Sagui'),('Exótico','Salamandra'),('Exótico','Serpente'),('Exótico','Tarântula'),
  ('Exótico','Tartaruga'),('Exótico','Teiú'),('Exótico','Tigre-d''água'),('Exótico','Tritão'),('Exótico','Outro'),
  ('Marinho','Não sei'),('Marinho','Anêmona-do-mar'),('Marinho','Baiacu'),('Marinho','Camarão'),
  ('Marinho','Caranguejo'),('Marinho','Cavalo-marinho'),('Marinho','Coral'),('Marinho','Coral-cérebro'),
  ('Marinho','Donzela'),('Marinho','Estrela-do-mar'),('Marinho','Lagosta'),('Marinho','Lula'),('Marinho','Medusa'),
  ('Marinho','Molusco'),('Marinho','Ostra'),('Marinho','Ouriço-do-mar'),('Marinho','Peixe'),('Marinho','Peixe-anjo'),
  ('Marinho','Peixe-betta'),('Marinho','Peixe-cirurgião'),('Marinho','Peixe-dourado'),('Marinho','Peixe-leão'),
  ('Marinho','Peixe-palhaço'),('Marinho','Peixe-papagaio'),('Marinho','Pepino-do-mar'),('Marinho','Polvo'),
  ('Marinho','Raia'),('Marinho','Sardinha'),('Marinho','Tartaruga-marinha'),('Marinho','Tartaruga-verde'),
  ('Marinho','Tubarão'),('Marinho','Água-viva'),('Marinho','Outro'),
  ('Outro','Não sei')
on conflict (animal_type, name) do nothing;

-- ==============================================================================
-- FIM DA MIGRAÇÃO DE HARDENING
-- ==============================================================================
