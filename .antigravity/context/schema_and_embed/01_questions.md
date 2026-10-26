# FASE 1: AUDITORIA DO SCHEMA ANTIGO E LEVANTAMENTO DE PERGUNTAS (QUESTIONADOR_MELHORIAS)

## Loop 1/3: Dissecação do Schema Antigo e Foreign Keys Duplicadas
- **Subagente Ativo:** `[QUESTIONADOR_MELHORIAS]` com apoio de `[BACKEND_ENGINEER]`
- **Skill Consultada:** `https://github.com/PostgREST/postgrest` -> *Resource Embedding -> Disambiguating Relationships*
- **Análise das Foreign Keys Conflitantes:**
  1. No schema original (`20261019_complete_security_hardening.sql`), a tabela `public.posts` foi criada com `user_id uuid not null references auth.users(id) on delete cascade`.
  2. Como `public.profiles` tem `id uuid references auth.users(id)`, em instalações reais do Supabase foram adicionadas constraints ligando `posts(user_id)` diretamente a `profiles(id)`.
  3. Na migração `20261026_performance_and_security_optimization.sql`, foi executado:
     `alter table public.posts add constraint posts_user_id_profiles_fkey foreign key (user_id) references public.profiles(id) on delete cascade;`
  4. Quando coexistem duas foreign keys entre as mesmas tabelas (por exemplo, `posts_user_id_fkey` e `posts_user_id_profiles_fkey`, ou uma nova foreign key para moderação como `posts_moderator_id_fkey`), o PostgREST dispara o erro `PGRST201` ("Could not embed because more than one relationship was found for 'posts' and 'profiles'").
  5. **Conclusão:** É indispensável padronizar nomes canônicos e explícitos para todas as constraints no novo `schema.sql`:
     - Autor da publicação: `CONSTRAINT posts_author_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE`
     - Moderador da publicação: `CONSTRAINT posts_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.profiles(id) ON DELETE SET NULL`
     - Remover quaisquer constraints duplicadas ou com nomes gerados automaticamente pelo PostgreSQL antes de criá-las.

---

## Loop 2/3: Mapeamento de Queries Quebradas no Frontend
- **Subagente Ativo:** `[QUESTIONADOR_MELHORIAS]` com apoio de `[FRONTEND_ENGINEER]`
- **Skill Consultada:** `https://github.com/supabase/postgrest-js` -> *Embedded Resource Syntax & Disambiguation*
- **Queries Identificadas com Embed de Profiles:**
  1. `script.js` linha 1273 (`renderPendingPostsAdmin`):
     - Código: `.from('posts').select('*, profiles(full_name, email, username)').eq('status', 'pending')`
     - Status: Quebrava com erro PGRST201 impedindo o carregamento da fila de aprovação de posts no painel de administração.
     - Correção: Usar hint explícito `profiles:profiles!posts_author_id_fkey(full_name, email, username)`.
  2. `script.js` linha 2606 (`POST_CARD_COLUMNS`):
     - Código: `'..., profiles(full_name, username, avatar_url)'`
     - Status: Ponto crítico que alimenta o feed principal, renderização de cards recentes e página de favoritos.
     - Correção: `'..., profiles:profiles!posts_author_id_fkey(full_name, username, avatar_url)'`.
  3. `script.js` linha 3563 (`openAdoptionModal`):
     - Código: `.from('posts').select('*, profiles(full_name, username, avatar_url)').eq('id', postOrId)`
     - Status: Utilizado no fallback de abertura do modal quando o post não está no cache em memória.
     - Correção: `.select('*, profiles:profiles!posts_author_id_fkey(full_name, username, avatar_url)')`.
  4. `script.js` linha 4238 (`checkSharedPostOnLoad`):
     - Código: `.from('posts').select('*, profiles(full_name, username, avatar_url)').eq('id', postId)`
     - Status: Utilizado ao abrir posts compartilhados diretamente via link `?post=<id>`.
     - Correção: `.select('*, profiles:profiles!posts_author_id_fkey(full_name, username, avatar_url)')`.

---

## Loop 3/3: Gargalos de Performance e Segurança no Schema Antigo
- **Subagente Ativo:** `[QUESTIONADOR_MELHORIAS]`
- **Skill Consultada:** `https://github.com/supabase/index_advisor` e `https://github.com/donnemartin/system-design-primer`
- **Problemas e Gargalos Diagnosticados no Schema Antigo:**
  1. **Avaliação Linha a Linha de RLS:** Políticas RLS que utilizavam chamadas diretas como `auth.uid() = user_id` forçavam o PostgreSQL a invocar a função `auth.uid()` para cada tupla escaneada, gerando N+1 em queries com paginação ou filtros complexos.
     - *Solução:* Encapsular em subquery escalar `(select auth.uid())` e `(select public.is_admin())`, permitindo que o planejador converta a verificação em um `InitPlan` estático de custo $O(1)$.
  2. **Ausência de Índices B-Tree nas Foreign Keys:** A coluna `posts.user_id` e a nova `posts.moderator_id` necessitam de índices explícitos para suportar queries de junção e cascatas de deleção sem Sequential Scans na tabela inteira.
  3. **Índice B-Tree Composto de Moderação:** Consultas de publicações pendentes filtram por `status = 'pending'` ordenando por `created_at desc`. É vital um índice parcial ou composto dedicado `posts (status, created_at desc)`.
  4. **Falta de Idempotência e Conflitos de Execução:** Execuções repetidas de scripts no Supabase geravam falhas de tipo `constraint already exists` ou `policy already exists`. O novo schema deve utilizar cláusulas `IF NOT EXISTS`, blocos defensivos `DO $$` e comandos `DROP POLICY IF EXISTS`.
  5. **Recarregamento de Cache do PostgREST:** Após criação de constraints e funções, se o schema cache do PostgREST não for recarregado, ele continua reportando erro de relacionamento até o reinício do container.
     - *Solução:* Terminar o script com `NOTIFY pgrst, 'reload schema';`.
