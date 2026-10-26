# FASE 2: ARQUITETURA DO NOVO SCHEMA.SQL E QUERIES (ARQUITETO_SOLUCOES)

## Loop 1/3: Desenho Arquitetural do Novo `schema.sql` Unificado
- **Subagente Ativo:** `[ARQUITETO_SOLUCOES]` com apoio de `[BACKEND_ENGINEER]`
- **Skill Consultada:** `https://github.com/supabase/index_advisor` e `https://github.com/donnemartin/system-design-primer`
- **Estrutura das Tabelas e Foreign Keys Padronizadas:**
  1. `public.profiles`:
     - Tabela primária de contas de usuários, chave primária `id uuid REFERENCES auth.users(id) ON DELETE CASCADE`.
     - Campos: `email`, `full_name`, `username`, `birth_date`, `avatar_url`, `favorite_posts`, `role`, `status`, timestamps.
  2. `public.posts`:
     - Contém todos os campos originais de características de animais, filtros booleanos tri-state, campos de modalidade (`lt_duration`, `lt_costs_covered`, `lt_home_requirements`, `sponsorship_purpose`, `sponsorship_goal`, `sponsorship_pix`), telemetria (`views_count`, `reports_count`) e busca (`search_tsv`).
     - Adição das colunas de auditoria de moderação:
       - `moderator_id uuid`
       - `moderated_at timestamptz`
     - **Constraint do Autor:**
       `CONSTRAINT posts_author_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE`
     - **Constraint do Moderador:**
       `CONSTRAINT posts_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.profiles(id) ON DELETE SET NULL`
  3. Matriz de Índices de Alta Performance:
     - `posts_user_id_idx`: B-Tree em `user_id` (para joins e deleção rápida).
     - `posts_moderator_id_idx`: B-Tree em `moderator_id`.
     - `posts_status_created_idx`: B-Tree composto em `(status, created_at desc)`.
     - `posts_feed_category_status_created_idx`: B-Tree composto em `(animal_type, status, created_at desc)`.
     - `posts_region_status_idx`: B-Tree composto em `(state, city, status, created_at desc)`.
     - `posts_search_tsv_idx`: Índice GIN em `search_tsv` para busca full-text instantânea em português.
     - `posts_breed_trgm_idx`: Índice GIN com trigramas `gin_trgm_ops` para tolerância a digitação e autocomplete de raças.

---

## Loop 2/3: Desambiguação no Frontend Sincronizada com o Novo Schema
- **Subagente Ativo:** `[ARQUITETO_SOLUCOES]` com apoio de `[FRONTEND_ENGINEER]`
- **Skill Consultada:** `https://github.com/alan2207/bulletproof-react` e `https://github.com/supabase/postgrest-js`
- **Contrato de Junção Definido:**
  - O PostgREST permite o uso de alias e hints de relacionamento no formato `<alias>:<tabela>!<constraint>(<colunas>)`.
  - Ao requisitar `profiles:profiles!posts_author_id_fkey(full_name, username, avatar_url)`, o PostgREST usa especificamente a foreign key do autor (`posts_author_id_fkey`) e entrega o resultado aninhado na propriedade `profiles` do objeto do post.
  - Isso mantém compatibilidade de 100% com o código existente do frontend, preservando `post.profiles.full_name`, `post.profiles.username`, `post.profiles.avatar_url`.
  - Para a moderação administrativa, a query da fila pendente requisita:
    `profiles:profiles!posts_author_id_fkey(id, full_name, email, username, avatar_url, role)`
    e opcionalmente para histórico:
    `moderator:profiles!posts_moderator_id_fkey(id, full_name, username)`

---

## Loop 3/3: Idempotência SQL e Segurança de Contas
- **Subagente Ativo:** `[ARQUITETO_SOLUCOES]`
- **Skill Consultada:** `https://github.com/OWASP/CheatSheetSeries`
- **Padrões de Execução Segura e Idempotência:**
  1. **Remoção Prévia de Constraints Antigas / Conflitantes:**
     Utilizar blocos `DO $$` que detectam e removem constraints legadas com nomes concorrentes (`posts_user_id_profiles_fkey`, `posts_user_id_fkey`, etc.) antes de registrar as constraints padronizadas `posts_author_id_fkey` e `posts_moderator_id_fkey`.
  2. **RLS Blindado sem Vazamento:**
     - `profiles`:
       - Visitantes e usuários comuns só conseguem ler perfis ativos: `using (status = 'active' or (select auth.uid()) = id or (select public.is_admin()))`.
       - Administradores têm acesso de leitura a perfis banidos para gestão da moderação.
     - `posts`:
       - Posts ativos, em processo ou adotados são públicos (`status in ('active', 'in_process', 'adopted')`).
       - Posts pendentes e rejeitados só podem ser selecionados pelo autor `((select auth.uid()) = user_id)` ou por administradores `((select public.is_admin()))`.
  3. **Comentários Racionais:**
     Todos os blocos do script devem seguir estritamente o padrão:
     `-- NOTA: Feito [X] porque [Y deu problema] e resolvemos com [Z].`
  4. **Notificação do PostgREST:**
     `NOTIFY pgrst, 'reload schema';` ao final do script para atualização imediata sem downtime.
