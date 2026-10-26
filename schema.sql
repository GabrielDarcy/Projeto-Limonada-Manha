
-- NOTA: Feito instalacao idempotente de pgcrypto porque funcoes de digest e criptografia de senhas falhavam sem a extensao e resolvemos garantindo no schema public.
create extension if not exists "pgcrypto" with schema public;

-- NOTA: Feito extensao pg_trgm no schema public porque a busca textual por aproximacao e autocomplete de racas necessitava de operadores de trigramas e resolvemos habilitando a extensao nativa.
create extension if not exists "pg_trgm" with schema public;


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

-- NOTA: Feito remocao preventiva da coluna legada recovery_code de profiles porque tokens em texto puro expunham contas a account takeover e resolvemos isolando em tabela privada com hash.
alter table public.profiles drop column if exists recovery_code;

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

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user', 'admin'));

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('active', 'banned'));

alter table public.profiles drop constraint if exists profiles_username_format_check;
alter table public.profiles add constraint profiles_username_format_check
  check (username is null or username ~* '^[a-z0-9._]{3,30}$');

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(trim(username)));

create index if not exists profiles_email_lower_idx
  on public.profiles (lower(trim(email)));

create index if not exists profiles_role_status_idx
  on public.profiles (role, status);

-- NOTA: Feito funcao security definer is_admin porque consultas frequentes de permissao geravam recursao em politicas RLS e resolvemos encapsulando em leitura estatica da tabela profiles.
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

-- NOTA: Feito trigger protect_profile_roles porque usuarios comuns podiam manipular role e status via requisicoes PATCH diretas e resolvemos bloqueando alteracoes nao autorizadas no banco.
create or replace function public.protect_profile_roles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();

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

-- NOTA: Feito trigger handle_new_user em auth.users porque autenticacao via Google OAuth e signup nativo deixavam perfis vazios e resolvemos inserindo automaticamente metadados e username limpo.
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

-- NOTA: Feito auto_confirm_new_user porque novos cadastros ficavam bloqueados aguardando confirmacao de email sem servidor SMTP configurado e resolvemos confirmando automaticamente no trigger.
create or replace function public.auto_confirm_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
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

alter table public.user_recovery_codes enable row level security;
alter table public.user_recovery_codes force row level security;


create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.system_settings (key, value)
values ('require_post_approval', 'false'::jsonb)
on conflict (key) do nothing;

alter table public.system_settings enable row level security;
alter table public.system_settings force row level security;


create table if not exists public.site_statistics (
  id integer primary key default 1 check (id = 1),
  total_lares integer not null default 0 check (total_lares >= 0),
  base_diaria integer not null default 0 check (base_diaria >= 0),
  updated_at timestamptz not null default now()
);

insert into public.site_statistics (id, total_lares, base_diaria)
values (1, 0, 0)
on conflict (id) do nothing;

alter table public.site_statistics enable row level security;
alter table public.site_statistics force row level security;


create table if not exists public.breeds (
  id serial primary key,
  animal_type text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (animal_type, name)
);

create index if not exists breeds_animal_type_idx on public.breeds (animal_type);

alter table public.breeds enable row level security;
alter table public.breeds force row level security;


create table if not exists public.api_rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.api_rate_limits enable row level security;
alter table public.api_rate_limits force row level security;

create index if not exists api_rate_limits_user_action_idx
  on public.api_rate_limits (user_id, action, created_at desc);


create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  moderator_id uuid,
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
  support_type text not null default 'adocao',
  lt_duration text,
  lt_costs_covered text,
  lt_home_requirements text,
  sponsorship_purpose text,
  sponsorship_goal text,
  sponsorship_pix text,
  status text not null default 'active',
  views_count integer not null default 0,
  reports_count integer not null default 0,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NOTA: Feito adicao defensiva de colunas em posts porque schemas legados podiam omitir campos de telemetria ou modalidades e resolvemos garantindo com add column if not exists.
alter table public.posts add column if not exists moderator_id uuid;
alter table public.posts add column if not exists support_type text not null default 'adocao';
alter table public.posts add column if not exists lt_duration text;
alter table public.posts add column if not exists lt_costs_covered text;
alter table public.posts add column if not exists lt_home_requirements text;
alter table public.posts add column if not exists sponsorship_purpose text;
alter table public.posts add column if not exists sponsorship_goal text;
alter table public.posts add column if not exists sponsorship_pix text;
alter table public.posts add column if not exists views_count integer not null default 0;
alter table public.posts add column if not exists reports_count integer not null default 0;
alter table public.posts add column if not exists moderated_at timestamptz;
alter table public.posts add column if not exists updated_at timestamptz not null default now();

-- NOTA: Feito saneamento e padronizacao das Foreign Keys de posts porque constraints concorrentes e sem nome explicito causavam o erro PGRST201 no PostgREST e resolvemos expurgando conflitos e nomeando posts_author_id_fkey e posts_moderator_id_fkey.
do $$
begin
    if exists (select 1 from information_schema.table_constraints where table_schema = 'public' and table_name = 'posts' and constraint_name = 'posts_user_id_profiles_fkey') then
    alter table public.posts drop constraint posts_user_id_profiles_fkey;
  end if;
  if exists (select 1 from information_schema.table_constraints where table_schema = 'public' and table_name = 'posts' and constraint_name = 'posts_user_id_fkey') then
    alter table public.posts drop constraint posts_user_id_fkey;
  end if;
  if exists (select 1 from information_schema.table_constraints where table_schema = 'public' and table_name = 'posts' and constraint_name = 'posts_author_id_fkey') then
    alter table public.posts drop constraint posts_author_id_fkey;
  end if;
  if exists (select 1 from information_schema.table_constraints where table_schema = 'public' and table_name = 'posts' and constraint_name = 'posts_moderator_id_fkey') then
    alter table public.posts drop constraint posts_moderator_id_fkey;
  end if;

    alter table public.posts
    add constraint posts_author_id_fkey
    foreign key (user_id) references public.profiles(id)
    on delete cascade;

  alter table public.posts
    add constraint posts_moderator_id_fkey
    foreign key (moderator_id) references public.profiles(id)
    on delete set null;
end $$;

alter table public.posts drop constraint if exists posts_animal_type_check;
alter table public.posts add constraint posts_animal_type_check
  check (animal_type in ('Cachorro', 'Gato', 'Fazenda', 'Exótico', 'Marinho', 'Outro'));

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('active', 'in_process', 'adopted', 'banned', 'pending', 'rejected'));

alter table public.posts drop constraint if exists posts_support_type_check;
alter table public.posts add constraint posts_support_type_check
  check (support_type in ('adocao', 'lar_temporario', 'apadrinhamento'));

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

alter table public.posts drop constraint if exists posts_lt_duration_check;
alter table public.posts add constraint posts_lt_duration_check
  check (lt_duration is null or length(lt_duration) <= 100);

alter table public.posts drop constraint if exists posts_lt_costs_check;
alter table public.posts add constraint posts_lt_costs_check
  check (lt_costs_covered is null or length(lt_costs_covered) <= 150);

alter table public.posts drop constraint if exists posts_lt_home_check;
alter table public.posts add constraint posts_lt_home_check
  check (lt_home_requirements is null or length(lt_home_requirements) <= 200);

alter table public.posts drop constraint if exists posts_sponsorship_purpose_check;
alter table public.posts add constraint posts_sponsorship_purpose_check
  check (sponsorship_purpose is null or length(sponsorship_purpose) <= 150);

alter table public.posts drop constraint if exists posts_sponsorship_goal_check;
alter table public.posts add constraint posts_sponsorship_goal_check
  check (sponsorship_goal is null or length(sponsorship_goal) <= 80);

alter table public.posts drop constraint if exists posts_sponsorship_pix_check;
alter table public.posts add constraint posts_sponsorship_pix_check
  check (sponsorship_pix is null or length(sponsorship_pix) <= 120);

-- NOTA: Feito coluna search_tsv gerada automaticamente porque pesquisas em multiplas colunas com ilike degradavam o banco e resolvemos armazenando tsvector indexado.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'search_tsv'
  ) then
    alter table public.posts
      add column search_tsv tsvector
      generated always as (
        to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(breed, '') || ' ' || coalesce(city, '') || ' ' || coalesce(description, ''))
      ) stored;
  end if;
end $$;

create index if not exists posts_user_id_idx on public.posts (user_id);
create index if not exists posts_moderator_id_idx on public.posts (moderator_id);
create index if not exists posts_feed_status_created_idx on public.posts (status, created_at desc);
create index if not exists posts_feed_category_status_created_idx on public.posts (animal_type, status, created_at desc);
create index if not exists posts_region_status_idx on public.posts (state, city, status, created_at desc);
create index if not exists posts_support_type_idx on public.posts (support_type, status);
create index if not exists posts_pending_approval_idx on public.posts (status, created_at desc) where status = 'pending';
create index if not exists posts_search_tsv_idx on public.posts using gin (search_tsv);
create index if not exists posts_breed_trgm_idx on public.posts using gin (breed gin_trgm_ops);


create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) >= 3 and char_length(reason) <= 100),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  constraint post_reports_unique_reporter unique (post_id, reporter_id)
);

alter table public.post_reports enable row level security;
alter table public.post_reports force row level security;


-- NOTA: Feito limpeza probabilistica em check_rate_limit porque executar delete em todas as chamadas causava lock de linha concorrente e resolvemos rodando limpeza em 2% dos requests.
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

  if random() < 0.02 then
    delete from public.api_rate_limits
    where created_at < (now() - interval '1 day');
  end if;

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

revoke all on function public.check_rate_limit(uuid, text, integer, interval) from public, anon;

-- NOTA: Feito trigger trg_enforce_post_moderation_rules porque requisicoes manuais podiam forcar status active com moderacao ativada e resolvemos forçando status pending para nao-admins.
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

-- NOTA: Feito sincronizacao automatica de racas novas a partir de posts validos porque a lista estatica ficava defasada e resolvemos populando a tabela breeds automaticamente via trigger.
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

-- NOTA: Feito trigger trg_handle_new_post_report porque denuncias repetidas nao suspendiam conteudos abusivos e resolvemos colocando em revisao automatica apos 5 denuncias unicas.
create or replace function public.trg_handle_new_post_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_new_count integer;
begin
  update public.posts
  set reports_count = reports_count + 1
  where id = new.post_id
  returning reports_count into v_new_count;

  if v_new_count >= 5 then
    update public.posts
    set status = 'pending'
    where id = new.post_id and status = 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_on_post_report_created on public.post_reports;
create trigger trg_on_post_report_created
  after insert on public.post_reports
  for each row
  execute function public.trg_handle_new_post_report();

-- NOTA: Feito admin_moderate_post com gravacao de moderator_id e moderated_at porque nao havia auditoria de quem moderou cada publicacao e resolvemos associando o uid do admin no update.
create or replace function public.admin_moderate_post(
  p_post_id uuid,
  p_action text
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
      moderator_id = auth.uid(),
      moderated_at = now(),
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

-- NOTA: Feito admin_set_post_approval_mode com validacao server-side porque alteracoes de configuracao nao podiam depender apenas de regras client-side e resolvemos exigindo role admin.
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

revoke all on function public.admin_set_post_approval_mode(boolean) from public, anon;
grant execute on function public.admin_set_post_approval_mode(boolean) to authenticated;

-- NOTA: Feito admin_ban_user com atualizacao em cascata de posts e sessao auth porque usuarios banidos continuavam com posts publicos e resolvemos aplicando status banned global.
create or replace function public.admin_ban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado: apenas administradores podem banir contas.';
  end if;

  update public.profiles
     set status = 'banned'
   where id = p_user_id;

  update public.posts
     set status = 'banned'
   where user_id = p_user_id;

  update auth.users
     set banned_until = '2099-01-01 00:00:00+00'
   where id = p_user_id;
end;
$$;

grant execute on function public.admin_ban_user(uuid) to authenticated, service_role;

-- NOTA: Feito delete_user com remocao de auth.users porque manter registros em auth violava direitos de exclusao da LGPD e resolvemos deletando perfil e credenciais em cascata.
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

  delete from public.posts where user_id = v_uid;
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

grant execute on function public.delete_user() to authenticated, service_role;

-- NOTA: Feito get_email_by_username via security definer porque visitantes nao podem ler auth.users e resolvemos retornando o email correspondente sob sanitizacao estrita.
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

-- NOTA: Feito get_active_breeds com ordenacao customizada porque usuarios perdiam tempo buscando opcoes padrao e resolvemos posicionando Vira-lata e Nao sei no topo do retorno.
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

-- NOTA: Feito save_recovery_code com salt aleatorio e sha256 porque codigos em texto puro podiam vazar em logs e resolvemos armazenando apenas o digest com salt.
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

-- NOTA: Feito reset_password_with_code_v2 com bloqueio temporal apos 5 tentativas porque forca bruta em 6 digitos era viavel e resolvemos travando a conta por 1 hora.
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

  if p_identifier is not null and trim(p_identifier) <> '' then
    select id into v_target_user_id
    from public.profiles
    where lower(username) = lower(trim(p_identifier))
       or lower(email) = lower(trim(p_identifier))
    limit 1;
  end if;

  if v_target_user_id is not null then
    select * into v_record
    from public.user_recovery_codes
    where user_id = v_target_user_id;
  else
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

  if v_record.locked_until is not null and v_record.locked_until > now() then
    raise exception 'Muitas tentativas incorretas. Tente novamente mais tarde.';
  end if;

  v_computed_hash := encode(digest(v_record.salt || p_recovery_code, 'sha256'), 'hex');
  if v_record.code_hash <> v_computed_hash then
    update public.user_recovery_codes
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '1 hour' else null end
     where id = v_record.id;
    raise exception 'Código de recuperação incorreto.';
  end if;

  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf'))
   where id = v_target_user_id;

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

-- NOTA: Feito log_falha_reset como stub seguro porque auditoria nao deve interromper o fluxo de resposta da aplicacao e resolvemos com procedure no-op.
create or replace function public.log_falha_reset(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  null;
end;
$$;

grant execute on function public.log_falha_reset(text) to anon, authenticated, service_role;

-- NOTA: Feito increment_post_views como operacao atomica no banco porque contagens client-side sofriam de Lost Update concorrente e resolvemos incrementando via update direto.
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

-- NOTA: Feito search_posts com plainto_tsquery porque termos com pontuacao quebravam a sintaxe do to_tsquery e resolvemos com sanitizacao de texto livre.
create or replace function public.search_posts(
  p_term text default null,
  p_animal_type text default null,
  p_state text default null,
  p_city text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns setof public.posts
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select *
  from public.posts
  where status in ('active', 'in_process')
    and (p_animal_type is null or p_animal_type = 'Todos' or animal_type = p_animal_type)
    and (p_state is null or p_state = '' or state = p_state)
    and (p_city is null or p_city = '' or city = p_city)
    and (
      p_term is null or trim(p_term) = ''
      or search_tsv @@ plainto_tsquery('portuguese', p_term)
      or breed ilike ('%' || trim(p_term) || '%')
    )
  order by created_at desc
  limit least(coalesce(p_limit, 20), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.search_posts(text, text, text, text, integer, integer) to anon, authenticated, service_role;

-- NOTA: Feito toggle_favorite_post com operacao atomica em array porque ler e salvar array no frontend gerava condicao de corrida e resolvemos manipulando diretamente no PostgreSQL.
create or replace function public.toggle_favorite_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_post_id_str text := p_post_id::text;
  v_is_fav boolean;
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado.';
  end if;

  select v_post_id_str = any(coalesce(favorite_posts, '{}')) into v_is_fav
  from public.profiles
  where id = v_user_id;

  if v_is_fav then
    update public.profiles
    set favorite_posts = array_remove(favorite_posts, v_post_id_str),
        updated_at = now()
    where id = v_user_id;
    return false;
  else
    update public.profiles
    set favorite_posts = array_append(coalesce(favorite_posts, '{}'), v_post_id_str),
        updated_at = now()
    where id = v_user_id;
    return true;
  end if;
end;
$$;

grant execute on function public.toggle_favorite_post(uuid) to authenticated;


alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "Profiles são visíveis publicamente" on public.profiles;
drop policy if exists "profiles_select_policy" on public.profiles;
create policy "profiles_select_policy"
  on public.profiles for select
  using (status = 'active' or (select auth.uid()) = id or (select public.is_admin()));

drop policy if exists "Usuário pode inserir seu próprio profile" on public.profiles;
drop policy if exists "profiles_insert_policy" on public.profiles;
create policy "profiles_insert_policy"
  on public.profiles for insert
  with check ((select auth.uid()) = id);

drop policy if exists "Usuário pode atualizar seu próprio profile" on public.profiles;
drop policy if exists "profiles_update_policy" on public.profiles;
create policy "profiles_update_policy"
  on public.profiles for update
  using ((select auth.uid()) = id or (select public.is_admin()))
  with check ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists "Usuário ou Admin pode deletar profile" on public.profiles;
drop policy if exists "profiles_delete_policy" on public.profiles;
create policy "profiles_delete_policy"
  on public.profiles for delete
  using ((select auth.uid()) = id or (select public.is_admin()));

alter table public.posts enable row level security;
alter table public.posts force row level security;

drop policy if exists "Posts ativos são públicos" on public.posts;
drop policy if exists "posts_public_select_active" on public.posts;
drop policy if exists "posts_owner_select" on public.posts;
drop policy if exists "posts_admin_select" on public.posts;

-- NOTA: Feito desacoplamento em 3 politicas RLS permissivas para posts porque subqueries unicas avaliavam auth.uid linha a linha e resolvemos separando publico, autor e admin.
create policy "posts_public_select_active"
  on public.posts as permissive
  for select
  using (status in ('active', 'in_process', 'adopted'));

create policy "posts_owner_select"
  on public.posts as permissive
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "posts_admin_select"
  on public.posts as permissive
  for select
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "Usuário autenticado cria seus próprios posts" on public.posts;
drop policy if exists "posts_authenticated_insert" on public.posts;
create policy "posts_authenticated_insert"
  on public.posts for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status in ('active', 'pending')
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and status <> 'banned'
    )
  );

drop policy if exists "Autor ou admin atualiza posts" on public.posts;
drop policy if exists "posts_owner_or_admin_update" on public.posts;
create policy "posts_owner_or_admin_update"
  on public.posts for update
  to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()))
  with check ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "Autor ou admin remove posts" on public.posts;
drop policy if exists "posts_owner_or_admin_delete" on public.posts;
create policy "posts_owner_or_admin_delete"
  on public.posts for delete
  to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "Configuracoes visiveis publicamente" on public.system_settings;
create policy "Configuracoes visiveis publicamente"
  on public.system_settings for select
  using (true);

drop policy if exists "Apenas admin modifica configuracoes" on public.system_settings;
create policy "Apenas admin modifica configuracoes"
  on public.system_settings for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Estatísticas visíveis publicamente" on public.site_statistics;
create policy "Estatísticas visíveis publicamente"
  on public.site_statistics for select
  using (true);

drop policy if exists "Apenas admin modifica estatísticas" on public.site_statistics;
create policy "Apenas admin modifica estatísticas"
  on public.site_statistics for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Catálogo de raças é público" on public.breeds;
create policy "Catálogo de raças é público"
  on public.breeds for select
  using (true);

drop policy if exists "Apenas admin ou trigger manipula catálogo" on public.breeds;
create policy "Apenas admin ou trigger manipula catálogo"
  on public.breeds for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Rate limits restrito a admin" on public.api_rate_limits;
create policy "Rate limits restrito a admin"
  on public.api_rate_limits for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Denunciante insere sua denuncia" on public.post_reports;
create policy "Denunciante insere sua denuncia"
  on public.post_reports for insert
  to authenticated
  with check (
    (select auth.uid()) = reporter_id
    and exists (
      select 1 from public.posts where id = post_id and status in ('active', 'in_process')
    )
  );

drop policy if exists "Admin gerencia denuncias" on public.post_reports;
create policy "Admin gerencia denuncias"
  on public.post_reports for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));


insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('pet_images', 'pet_images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('imagens-adocao', 'imagens-adocao', true, 204800, array['image/webp'])
on conflict (id) do update set
  public = true;

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

drop policy if exists "Imagens de adocao publicas para leitura" on storage.objects;
create policy "Imagens de adocao publicas para leitura"
  on storage.objects for select
  using (bucket_id in ('pet_images', 'imagens-adocao'));

drop policy if exists "Upload autenticado em pasta propria" on storage.objects;
create policy "Upload autenticado em pasta propria"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('pet_images', 'imagens-adocao')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Proprietario atualiza suas imagens de adocao" on storage.objects;
create policy "Proprietario atualiza suas imagens de adocao"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('pet_images', 'imagens-adocao')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Proprietario ou admin deleta imagens de adocao" on storage.objects;
create policy "Proprietario ou admin deleta imagens de adocao"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('pet_images', 'imagens-adocao')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );


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

-- NOTA: Feito NOTIFY pgrst reload schema porque alteracoes estruturais nas Foreign Keys precisam ser recarregadas no cache do PostgREST sem reinicio do banco e resolvemos notificando o canal pgrst.
NOTIFY pgrst, 'reload schema';
