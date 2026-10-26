# FASE 3: CRÍTICA ÀS SOLUÇÕES E AUDITORIA RED TEAM (CRITICO_REDTEAM)

## Loop 1/3: Auditoria Comparativa do Schema Antigo vs. Novo
- **Subagente Ativo:** `[CRITICO_REDTEAM]`
- **Skill Consultada:** `https://github.com/semgrep/semgrep-rules` e `https://github.com/supabase/supabase`
- **Critérios de Fidelidade e Integridade Funcional:**
  1. **Inventário de Tabelas:** O novo `schema.sql` deve conter exatamente todas as 8 tabelas de produção: `profiles`, `user_recovery_codes`, `posts`, `site_statistics`, `breeds`, `system_settings`, `api_rate_limits`, `post_reports`. Nenhuma tabela do histórico pode ser omitida.
  2. **Triggers e Funções Críticas:**
     - `handle_new_user` em `auth.users`: Essencial para login com Google OAuth e cadastro via e-mail.
     - `auto_confirm_new_user` em `auth.users`: Garante que novos usuários entrem imediatamente sem travar na confirmação de e-mail.
     - `protect_profile_roles` em `profiles`: Bloqueia que usuários comuns elevem seu privilégio para admin via API REST.
     - `trg_enforce_post_moderation_rules` em `posts`: Impede publicação sem moderação quando `require_post_approval` estiver ativado.
     - `toggle_favorite_post`, `search_posts`, `increment_post_views`, `save_recovery_code`, `reset_password_with_code_v2`: Devem estar 100% preservadas e otimizadas.
  3. **Extensões Obrigatórias:** `pgcrypto` (para digest e gen_random_bytes) e `pg_trgm` (para busca por aproximação de raças e termos).

---

## Loop 2/3: Crítica de Contrato Frontend <-> Backend
- **Subagente Ativo:** `[CRITICO_REDTEAM]` com apoio de `[FRONTEND_ENGINEER]`
- **Skill Consultada:** `https://github.com/supabase/postgrest-js` -> *Disambiguation Matching*
- **Análise Caractere por Caractere:**
  - Se a Foreign Key no SQL for definida como `CONSTRAINT posts_author_id_fkey`, o PostgREST só aceitará `!posts_author_id_fkey`.
  - Se houver discrepância de 1 caractere no nome (ex: `author_fkey` vs `posts_author_id_fkey`), o PostgREST retornará `PGRST200` (Relationship not found).
  - Portanto, todas as ocorrências no Frontend DEVEM ser padronizadas estritamente como:
    `profiles:profiles!posts_author_id_fkey(...)`
  - E caso o frontend em algum momento faça join com o moderador:
    `moderator:profiles!posts_moderator_id_fkey(...)`
  - O uso do prefixo `profiles:` garante que o retorno da API venha com o nó `post.profiles`, mantendo o contrato da interface 100% intacto sem necessidade de reescrever lógica de renderização.

---

## Loop 3/3: Auditoria de RLS na Fila de Moderação
- **Subagente Ativo:** `[CRITICO_REDTEAM]`
- **Skill Consultada:** `https://github.com/OWASP/CheatSheetSeries` -> *Authorization & Access Control*
- **Vulnerabilidade Identificada no Schema Anterior:**
  - No schema anterior, a política de `profiles` para SELECT era `using (status = 'active');`.
  - Se um usuário tivesse o status alterado ou banido temporariamente, o admin que tentasse carregar a fila de moderação com o join `profiles` receberia `profiles: null` ou erro de restrição.
  - Além disso, a subquery direta `public.is_admin()` em `using (public.is_admin())` degradava performance.
- **Correção Mandatória no Novo Schema:**
  - Política de `profiles`:
    `using (status = 'active' or (select auth.uid()) = id or (select public.is_admin()))`
  - Política de `posts` para admin:
    `create policy "posts_admin_select" on public.posts for select to authenticated using ((select public.is_admin()));`
  - Isso garante que administradores sempre tenham acesso irrestrito aos perfis dos autores durante a revisão de posts pendentes, com custo de CPU constante ($O(1)$) por meio do InitPlan do PostgreSQL.
