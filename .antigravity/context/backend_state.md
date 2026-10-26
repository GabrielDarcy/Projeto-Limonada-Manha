# BACKEND STATE — DIAGNÓSTICO E ENGENHARIA DE SERVIDOR

## 1. Visão Geral da Stack de Backend & Banco de Dados
- **Banco de Dados:** PostgreSQL 15+ hospedado via Supabase (PostgREST + GoTrue + Storage)
- **Camada de Acesso:** `@supabase/supabase-js` v2 (Client-side direto via Anon Key com RLS e RPCs Security Definer)
- **Tabelas Principais:** `posts`, `profiles`, `system_settings`, `api_rate_limits`, `site_statistics`, `breeds`

## 2. Diagnóstico da Regressão Crítica de Performance (Lentidão no Banco)
### A. Gargalo 1: Políticas RLS com Reavaliação Linha a Linha (Row-by-Row Execution)
- **Arquivo:** `supabase/migrations/20261020_post_approval_system.sql` (Linhas 54-61) e `20261019_complete_security_hardening.sql` (Linhas 651-658)
- **Código Problemático:**
  ```sql
  create policy "Posts ativos são públicos"
    on public.posts for select
    using (
      status in ('active', 'in_process', 'adopted')
      or auth.uid() = user_id
      or public.is_admin()
    );
  ```
- **Mecanismo da Degradação:**
  1. `auth.uid()` sem wrapper de subquery `(select auth.uid())` força o PostgreSQL a re-executar a chamada de função C interna a cada linha percorrida pelo sequential scan.
  2. `or public.is_admin()` executa para cada tupla:
     ```sql
     select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
     ```
     Isso cria um **N+1 subquery oculto dentro do motor do Postgres**: para 100 posts avaliados, são disparadas 100 queries na tabela `profiles`. Para 1.000 posts, 1.000 queries. Mesmo para visitantes anônimos (`auth.uid() is null`), a cláusula `OR` impede o otimizador de descartar a condição estaticamente sem avaliar as funções.
  3. A presença do `OR auth.uid() = user_id OR public.is_admin()` desabilita Index Condition Pushdown direto no índice `posts_feed_idx` para o caso público geral.

### B. Gargalo 2: Incompatibilidade de Índices B-Tree com Filtros do Feed
- **Arquivo:** `supabase/migrations/20261019_complete_security_hardening.sql` (Linha 261)
- **Índice Atual:**
  ```sql
  create index if not exists posts_feed_idx on public.posts (animal_type, status, created_at desc);
  ```
- **Mecanismo da Degradação:**
  - Na tela inicial (`index.html`), o filtro padrão é `animal_type = 'Todos'`, ou seja, a query enviada pelo PostgREST filtra apenas:
    ```sql
    where status = 'active' order by created_at desc;
    ```
  - Como `animal_type` é a coluna líder (*leading column*) do índice composto `posts_feed_idx`, o PostgreSQL **não pode usar o índice** para ordenar e filtrar quando `animal_type` não é especificado.
  - Resultado: Sequential Scan com Sort em memória (ou disco) em toda a tabela `posts`.

### C. Gargalo 3: Ausência de Chave Estrangeira Direta e N+1 em Join com `profiles`
- **Arquivo:** `supabase/migrations/20261019_complete_security_hardening.sql` (Linhas 205-206)
- **Definição:** `user_id uuid not null references auth.users(id)`
- **Mecanismo da Degradação:**
  - `posts` referencia `auth.users(id)`, enquanto o frontend executa `.select('*, profiles(full_name, username, avatar_url)')`.
  - Como não há restrição de integridade referencial `foreign key (user_id) references public.profiles(id)`, o PostgREST e o planner precisam deduzir a junção ou utilizar caminhos não indexados explicitamente na chave primária de profiles em conjunção com as regras de RLS da tabela `profiles`.

### D. Gargalo 4: Busca textual via `ILIKE '%termo%'` sem Índices GIN/Trigrama
- **Arquivo:** `script.js` (Linhas 2617, 3088)
- **Código:** `.ilike('breed', `%${breedValue}%`)` e buscas textuais por título/descrição
- **Mecanismo:** `ILIKE` com curinga inicial (`%termo%`) invalida índices B-Tree e força varredura completa de tabela a cada tecla digitada sem debounce adequado.

### E. Gargalo 5: Trigger de Moderação e Rate Limit Bloqueante em Escritas
- **Arquivo:** `supabase/migrations/20261023_complete_production_hardening.sql` (Linhas 64-138)
- **Mecanismo:** A cada `INSERT` ou `UPDATE`, a trigger executa `public.is_admin()`, consulta `system_settings` e faz `DELETE` síncrono em `api_rate_limits` (`where created_at < now() - interval '1 day'`). Esse `DELETE` limpa tuplas antigas na mesma transação de inserção do post, causando lock e latência de I/O na thread de escrita.
