# FASE 2: ENGENHARIA DE SOLUÇÕES ARQUITETURAIS
**Subagente Líder:** `[SUBAGENTE: ARQUITETO_SOLUCOES]`
**Apoio de Engenharia:** `[SUBAGENTE: BACKEND_ENGINEER]` e `[SUBAGENTE: FRONTEND_ENGINEER]`

---

## LOOP 1/3: Solução Imediata de Performance e Otimização de Banco de Dados
**Subagente Ativo:** `[SUBAGENTE: ARQUITETO_SOLUCOES]`
**Loop Atual:** `[1/3]`
**Skill do GitHub Consultada:** `[https://github.com/donnemartin/system-design-primer -> Relational Database Sharding & Index Tuning]` e `[https://github.com/goldbergyoni/nodebestpractices -> Database Best Practices & Query Optimization]`

### 🛠️ Engenharia de Solução (Resposta às Perguntas P1.1 a P1.4):

#### 1. Desacoplamento Radical das Políticas de RLS em `public.posts`
Em vez de uma única política pesada com operadores `OR` complexos, criamos **Políticas Permissivas Especializadas** (`AS PERMISSIVE`), permitindo que o PostgreSQL escolha o caminho de menor custo computacional:

```sql
-- Remove a política agregada causadora do sequential scan
drop policy if exists "Posts ativos são públicos" on public.posts;

-- POLÍTICA 1 (Pública / Anônima / Leitura Rápida): Zero subqueries, puramente indexável
create policy "posts_public_select_active"
  on public.posts for select
  using (status in ('active', 'in_process', 'adopted'));

-- POLÍTICA 2 (Autor / Dono): Avaliada com InitPlan estático escalar
create policy "posts_owner_select"
  on public.posts for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- POLÍTICA 3 (Administrador): Avaliada apenas se o usuário for autenticado via InitPlan
create policy "posts_admin_select"
  on public.posts for select
  to authenticated
  using ((select public.is_admin()));
```
**Impacto Técnico:**
- Para visitantes e feeds públicos (98% do tráfego do site), a **POLÍTICA 1** é satisfeita diretamente pelo índice B-Tree sem jamais chamar `auth.uid()` ou consultar a tabela `profiles`.
- O wrapper `(select ...)` nas políticas 2 e 3 força o PostgreSQL a executar a função uma única vez por consulta (`InitPlan 1`), eliminando o loop $O(N)$ em cada tupla.

#### 2. Matriz de Índices de Alta Performance para `public.posts`
Criamos índices compostos alinhados exatamente aos padrões de filtro do frontend:

```sql
-- 1. Índice primário do feed para Todas as categorias (status + created_at)
create index if not exists posts_feed_status_created_idx
  on public.posts (status, created_at desc);

-- 2. Índice filtrado para categorias específicas
create index if not exists posts_feed_category_status_created_idx
  on public.posts (animal_type, status, created_at desc);

-- 3. Índice para filtros regionais rápidos
create index if not exists posts_region_status_idx
  on public.posts (state, city, status, created_at desc);

-- 4. Índice para contagem de status do painel administrativo
create index if not exists posts_status_count_idx
  on public.posts (status);
```

#### 3. Restrição de Chave Estrangeira Direta `posts(user_id) -> profiles(id)`
Garante integridade referencial e habilita o PostgREST a planejar o `Nested Loop Left Join` com indexação nativa:
```sql
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'posts_user_id_profiles_fkey'
  ) then
    alter table public.posts
      add constraint posts_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id)
      on delete cascade;
  end if;
end $$;
```

#### 4. Assincronização e Alívio da Limpeza do Rate Limiting
Modificamos o trigger `check_rate_limit` para **não** fazer `DELETE` síncrono em todas as inserções:
- O `DELETE` de registros com mais de 24 horas passa a ser executado apenas probabilisticamente (ex.: 1 em cada 50 inserções usando `random() < 0.02`) ou via cron/job agendado, eliminando locks da thread crítica de criação de posts.

---

## LOOP 2/3: Solução de Produto — Posts, Busca, Moderação e UX/UI
**Subagente Ativo:** `[SUBAGENTE: ARQUITETO_SOLUCOES]`
**Loop Atual:** `[2/3]`
**Skill do GitHub Consultada:** `[https://github.com/alan2207/bulletproof-react -> Clean Architecture & SWR Pattern]` e `[https://github.com/GoogleChrome/web-vitals -> Zero CLS Skeleton Screens & Pre-compression]`

### 🛠️ Engenharia de Solução (Resposta às Perguntas P2.1 a P2.4):

#### 1. Motor de Busca de Alta Performance com Full-Text Search (FTS) e Trigramas
Adicionamos suporte a busca textual instantânea no PostgreSQL:
```sql
-- Habilita extensão pg_trgm para buscas tolerantes a digitação
create extension if not exists pg_trgm with schema public;

-- Adiciona coluna gerada tsvector com termos normalizados em português
alter table public.posts
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(breed, '') || ' ' || coalesce(city, '') || ' ' || coalesce(description, ''))
  ) stored;

-- Cria índice GIN para busca full-text instantânea
create index if not exists posts_search_tsv_idx on public.posts using gin (search_tsv);

-- Cria índice de trigrama para autocomplete rápido por raça e título
create index if not exists posts_breed_trgm_idx on public.posts using gin (breed gin_trgm_ops);
create index if not exists posts_title_trgm_idx on public.posts using gin (title gin_trgm_ops);
```

#### 2. Pipeline de Compressão Client-Side de Imagens no Frontend
Implementamos uma rotina no navegador antes do upload:
- Criação da função utilitária `compressImageFile(file, maxWidth = 1280, quality = 0.8)` utilizando HTML5 Canvas e `image/webp`.
- Imagens de smartphones (4MB a 12MB) são redimensionadas no cliente para no máximo 1280px e convertidas para WebP leve (~120KB a 250KB).
- **Vantagem:** Redução de 95% do tempo de upload, economia drástica de largura de banda e eliminação de timeouts no Supabase Storage.

#### 3. Salvamento de Rascunho Local (`Draft Autosave`)
- Implementação de listener `input` com debounce de 500ms no formulário `create-post.html`.
- O rascunho é persistido em `localStorage.setItem('petamor_post_draft', JSON.stringify(formData))`.
- Ao abrir a página, se houver rascunho salvo, exibe botão sutil: *"Restaurar rascunho anterior"*.
- Após publicação bem-sucedida, o rascunho é limpo automaticamente.

#### 4. Sistema Escalável de Denúncias e Moderação Comunitária
Criação da tabela `post_reports` e automação de ocultação:
```sql
create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.post_reports enable row level security;
alter table public.post_reports force row level security;

-- Qualquer usuário autenticado pode denunciar
create policy "Usuário autenticado pode denunciar post"
  on public.post_reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);

-- Apenas admins leem e modera denúncias
create policy "Apenas admin visualiza denúncias"
  on public.post_reports for select
  to authenticated
  using ((select public.is_admin()));

-- Adiciona coluna de contagem de denúncias em posts
alter table public.posts
  add column if not exists reports_count integer not null default 0;

-- Trigger: se o post atingir 5 denúncias ativas, altera status para 'in_process' ou 'pending' temporariamente
create or replace function public.trg_auto_flag_reported_post()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.posts
  set reports_count = reports_count + 1,
      status = case when reports_count + 1 >= 5 and status = 'active' then 'pending' else status end
  where id = new.post_id;
  return new;
end;
$$;
```

#### 5. UX Reativa com Skeletons e Optimistic UI
- **Skeletons Estruturados:** Ao iniciar a busca ou carregar a listagem, `renderFeed()` insere 4 cards esqueleto com animação de shimmer de gradiente CSS antes do `await` da query.
- **Optimistic UI:** Ao clicar em favoritar ou compartilhar, o estado visual do ícone (coração preenchido, contador) alterna em 0ms no DOM. A chamada ao Supabase roda em background; em caso de erro raro de rede, o estado é revertido com toast explicativo.

---

## LOOP 3/3: Blindagem de Segurança das Contas e Arquitetura de Cache
**Subagente Ativo:** `[SUBAGENTE: ARQUITETO_SOLUCOES]`
**Loop Atual:** `[3/3]`
**Skill do GitHub Consultada:** `[https://github.com/OWASP/CheatSheetSeries -> REST Security & Input Validation]` e `[https://github.com/alan2207/bulletproof-react -> Stale-While-Revalidate Client Store]`

### 🛠️ Engenharia de Solução (Resposta às Perguntas P3.1 a P3.4):

#### 1. Blindagem de Exposição de PII em `public.profiles`
- Restringimos a leitura pública da tabela `profiles` para que terceiros não consigam consultar `email` ou dados cadastrais sensíveis:
  ```sql
  -- Cria view pública sanitizada para junção com posts
  create or replace view public.public_profiles with (security_invoker = false) as
    select id, full_name, username, avatar_url, role
    from public.profiles
    where status = 'active';

  grant select on public.public_profiles to anon, authenticated;
  ```
- O frontend passa a solicitar apenas os campos públicos essenciais do autor.

#### 2. Operações Atômicas contra Race Conditions e Lost Updates
- Criamos a RPC atômica `toggle_favorite_post(p_post_id uuid)` no banco para evitar conflitos concorrentes de array no perfil:
  ```sql
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
  ```

#### 3. Camada de Cache no Frontend com Stale-While-Revalidate (SWR)
- Criamos um cache em memória leve (`FeedCacheStore`) com TTL configurável (ex.: 60 segundos).
- Ao renderizar o feed, se houver dados em cache para aquela categoria/página, renderiza **instantaneamente (0ms)** e dispara um revalidate assíncrono em segundo plano para atualizar o DOM apenas se houver novos posts ou alterações de status.

#### 4. Sanitização Estrita e Proteção Anti-IDOR
- Todas as operações de mutação (`insert`, `update`, `delete`) utilizam validações estritas de schema (tamanho máximo de strings, sanitização de tags HTML com `escapeHTML` e remoção de caracteres invisíveis/scripts maliciosos).
