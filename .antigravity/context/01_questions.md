# FASE 1: DIAGNÓSTICO E PERGUNTAS DE MELHORIA
**Subagente Líder:** `[SUBAGENTE: QUESTIONADOR_MELHORIAS]`
**Apoio Técnico:** `[SUBAGENTE: BACKEND_ENGINEER]` e `[SUBAGENTE: FRONTEND_ENGINEER]`

---

## LOOP 1/3: Causa Raiz da Lentidão e Regressão de Performance Pós-Escalabilidade
**Subagente Ativo:** `[SUBAGENTE: QUESTIONADOR_MELHORIAS]`
**Loop Atual:** `[1/3]`
**Skill do GitHub Consultada:** `[https://github.com/supabase/index_advisor -> RLS InitPlan Optimization & Multi-column Index B-Tree Alignment]` e `[https://github.com/donnemartin/system-design-primer -> Database Indexing & Query Bottlenecks]`

### 🔍 Evidências Técnicas Coletadas nos Arquivos do Projeto:
1. **RLS N+1 Subquery Storm em Cada Linha de `posts`:**
   - No arquivo `supabase/migrations/20261020_post_approval_system.sql` (Linhas 54-61), a política de leitura ativa é:
     ```sql
     create policy "Posts ativos são públicos"
       on public.posts for select
       using (
         status in ('active', 'in_process', 'adopted')
         or auth.uid() = user_id
         or public.is_admin()
       );
     ```
   - A função `public.is_admin()` (`20261019_complete_security_hardening.sql`:70-84) dispara uma query interna na tabela `profiles`:
     ```sql
     select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
     ```
   - **Gargalo:** Como `auth.uid()` e `public.is_admin()` estão na cláusula `OR` sem o invólucro escalar `(select auth.uid())` e `(select public.is_admin())`, o motor do PostgreSQL não consegue transformá-los em nós `InitPlan` estáticos. Para cada linha de post examinada durante uma varredura de tabela ou índice, o Postgres reavalia a função ou dispara a subconsulta contra `profiles`. Para 1.000 posts, são até 1.000 consultas adicionais a `profiles` dentro da mesma chamada de API!

2. **Índice B-Tree Desalinhado com a Consulta Padrão do Feed:**
   - O índice existente é:
     ```sql
     create index if not exists posts_feed_idx on public.posts (animal_type, status, created_at desc);
     ```
   - No frontend (`script.js`:2609), a listagem inicial do feed carrega posts de "Todas" as categorias:
     ```javascript
     let query = getSupabaseClient().from('posts').select('*, profiles(...)').eq('status', 'active').order('created_at', { ascending: false });
     ```
   - **Gargalo:** Quando `animal_type` não está presente no `WHERE`, o índice composto `(animal_type, status, created_at desc)` não pode ser utilizado diretamente como índice condutor (*leading index*). O banco é forçado a fazer Sequential Scan ou Bitmap Heap Scan caríssimo, seguido de ordenação em memória.

3. **Inexistência de Chave Estrangeira Direta `posts.user_id -> profiles.id`:**
   - Em `20261019_complete_security_hardening.sql`:206:
     ```sql
     user_id uuid not null references auth.users(id) on delete cascade
     ```
   - `posts` não possui `FOREIGN KEY (user_id) REFERENCES public.profiles(id)`. Ao executar `.select('*, profiles(full_name, username, avatar_url)')`, o PostgREST precisa resolver um join indireto entre tabelas de schemas distintos (`public` e `auth`), o que degrada o plano de execução e impede otimizações de Nested Loop indexado direto.

4. **Trigger de Rate Limiting com Bloqueio de Escrita I/O:**
   - Em `20261023_complete_production_hardening.sql`:44-58, toda inserção de post dispara a função `check_rate_limit`, que executa:
     ```sql
     delete from public.api_rate_limits where created_at < (now() - interval '1 day');
     ```
   - **Gargalo:** Fazer limpeza de registros expirados síncrona dentro da transação de inserção adiciona locks e eleva a latência do cliente em conexões de alta concorrência.

### ❓ Perguntas Cirúrgicas de Diagnóstico (Loop 1/3):
* **P1.1:** Como isolar completamente a leitura pública de posts anônimos para que o PostgreSQL execute um Index-Only Scan puro sem avaliar `auth.uid()` nem `is_admin()`?
* **P1.2:** Por que a política RLS atual agrupa visitantes públicos, autores e administradores na mesma expressão booleana complexa em vez de utilizar políticas permissivas separadas (`AS PERMISSIVE`) otimizadas pelo planner?
* **P1.3:** Qual é a composição exata de índices (`status`, `created_at DESC`, `state`, `city`) necessária para que tanto a listagem geral quanto as buscas com filtros regionais operem em $O(\log N)$ sem ordenação em disco?
* **P1.4:** Como adicionar a foreign key direta para `profiles(id)` sem violar dados existentes e garantir que o PostgREST gere um join de custo mínimo?

---

## LOOP 2/3: Funcionalidades Core — Criação de Posts, Busca, Moderação e UX/UI
**Subagente Ativo:** `[SUBAGENTE: QUESTIONADOR_MELHORIAS]`
**Loop Atual:** `[2/3]`
**Skill do GitHub Consultada:** `[https://github.com/alan2207/bulletproof-react -> Component Architecture, State Management & Debouncing]` e `[https://github.com/GoogleChrome/web-vitals -> INP, LCP and Cumulative Layout Shift Prevention]`

### 🔍 Evidências Técnicas Coletadas nos Arquivos do Projeto:
1. **Mecanismo de Busca Arcaico e Não Escalável:**
   - Em `script.js`:2617, a busca de raças e termos é realizada via:
     ```javascript
     query = query.ilike('breed', `%${breedValue}%`);
     ```
   - Em `script.js`:3088, filtros de texto realizam busca sequencial. Não há suporte a Full-Text Search com índices invertidos (`tsvector` + `GIN`) nem extensão `pg_trgm` para tolerância a erros ortográficos (ex.: "labrador" vs "lavrador").
   - A busca não tem paginação por cursor (Keyset Pagination); ela utiliza `.range(offset, offset + limit)`, que degrada para $O(N)$ conforme o número de páginas cresce.

2. **Formulário de Criação de Posts Frágil:**
   - O formulário em `publicacoes/create-post.html` e `script.js`:2420 não realiza compressão de imagem no navegador antes do upload. Arquivos de 8MB são enviados em resolução original, estourando tempo de rede e espaço do Supabase Storage.
   - Não há salvamento de rascunho local (`localStorage`), de modo que se o usuário perder a conexão durante o preenchimento, todo o texto é perdido.
   - O botão de publicar pode ser clicado repetidamente durante a espera da rede, resultando em postagens duplicadas se o trigger não barrar por milissegundos.

3. **Moderação Sem Fila Dinâmica e Sem Sistema de Denúncias:**
   - Atualmente a moderação depende exclusivamente de um admin entrar em `admin/admin.html` e aprovar ou recusar posts na fila.
   - Não existe tabela de denúncias de usuários (`post_reports`). Se um post malicioso for aprovado ou entrar sem moderação prévia, a comunidade não tem como denunciar, nem o sistema consegue ocultar posts automaticamente quando atingem um limite de denúncias confiáveis.
   - Falta histórico imutável de auditoria (`audit_logs`) para registrar qual administrador aprovou, recusou ou baniu um usuário.

4. **Gargalos de UX/UI e Travamentos Visuais:**
   - Em `script.js`:2600, o contêiner do feed é limpo com `feedTarget.innerHTML = '';` antes da requisição. Não há Skeleton Loaders estruturados, gerando CLS severo e sensação de lentidão.
   - Curtidas e ações de favoritar (`script.js`:3150) esperam confirmação do servidor em vez de aplicar **Optimistic Updates** imediatos na interface.

### ❓ Perguntas Cirúrgicas de Produto e UX (Loop 2/3):
* **P2.1:** Como projetar uma coluna de Full-Text Search gerada (`tsvector`) na tabela `posts` com índice `GIN` para suportar buscas instantâneas por título, descrição, raça e cidade sem travamento?
* **P2.2:** Como implementar compressão automática de imagem via Canvas/WebWorker no frontend para reduzir imagens de 5MB para ~150KB (WebP) antes do upload, eliminando timeouts?
* **P2.3:** Como estruturar uma esteira de moderação comunitária segura com contagem automática de denúncias e ocultação temporária de posts suspeitos?
* **P2.4:** Como adotar Skeleton Screens e Optimistic UI em todas as ações de cards (favoritar, compartilhar, filtrar) para atingir INP < 100ms e LCP < 1.5s?

---

## LOOP 3/3: Escala Extrema, Concorrência e Blindagem de Segurança das Contas
**Subagente Ativo:** `[SUBAGENTE: QUESTIONADOR_MELHORIAS]`
**Loop Atual:** `[3/3]`
**Skill do GitHub Consultada:** `[https://github.com/OWASP/CheatSheetSeries -> Authorization Cheat Sheet & IDOR Prevention]` e `[https://github.com/goldbergyoni/nodebestpractices -> Security & Concurrency Defense]`

### 🔍 Evidências Técnicas Coletadas nos Arquivos do Projeto:
1. **Risco de IDOR e Vulnerabilidades nas Políticas de Update/Delete:**
   - Em `20261019_complete_security_hardening.sql`:637-645:
     ```sql
     create policy "Usuário pode atualizar seu próprio profile"
       on public.profiles for update
       using (auth.uid() = id or public.is_admin())
       with check (auth.uid() = id or public.is_admin());
     ```
   - O campo `favorite_posts text[]` reside na tabela `profiles`. A cada favoritação de post, o cliente faz `UPDATE profiles SET favorite_posts = ... WHERE id = auth.uid()`. Se dois cliques rápidos ocorrerem em abas diferentes, ocorre *Lost Update* concorrente por ausência de locking ou array append atômico no banco.

2. **Exposição de Informações Pessoais (PII) em Consultas Públicas:**
   - Ao executar `posts?select=*,profiles(full_name, username, avatar_url)`, o PostgREST aplica as políticas RLS de `profiles`.
   - Se a política de `profiles` permitir leitura pública irrestrita, colunas como `email` ou `birth_date` podem ser expostas se um atacante manipular os parâmetros de consulta na API REST do Supabase (`profiles(email,birth_date)`).

3. **Ausência de Cache de Leitura Stale-While-Revalidate no Frontend:**
   - O aplicativo faz chamadas diretas ao banco sem nenhuma camada de cache em memória ou sessionStorage para o feed inicial. Cada navegação de volta para a Home aciona um ciclo completo de requisições ao PostgreSQL.

### ❓ Perguntas Cirúrgicas de Segurança e Escala Extrema (Loop 3/3):
* **P3.1:** Como garantir que a API pública nunca possa expor colunas confidenciais de `profiles` (como e-mail e data de nascimento), criando uma View segura ou delimitando a política RLS com segurança em colunas?
* **P3.2:** Como transformar a favoritação de posts em uma operação atômica e imune a condições de corrida sem bloquear a tabela de perfis?
* **P3.3:** Como implementar uma camada de cache em memória no cliente com Stale-While-Revalidate (SWR) e invalidação inteligente para reduzir em até 80% as requisições ao PostgreSQL?
* **P3.4:** Como blindar os formulários contra payload bombs e injeções de script através de sanitização rigorosa antes da persistência?
