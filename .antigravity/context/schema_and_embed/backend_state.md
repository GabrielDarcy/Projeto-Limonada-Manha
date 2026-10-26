# Estado do Backend e Banco de Dados (PostgreSQL / Supabase)

## 1. Mapeamento de Tabelas Existentes
- `public.profiles`: Armazena dados de usuários sincronizados com `auth.users`. Possui `role` ('user', 'admin') e `status` ('active', 'banned').
- `public.posts`: Tabela principal de animais e anúncios. Possui campos de características, filtros, modalidades (`adocao`, `lar_temporario`, `apadrinhamento`), `status` ('active', 'in_process', 'adopted', 'banned', 'pending', 'rejected'), `user_id` (autor) e necessita de `moderator_id` (moderador/revisor).
- `public.system_settings`: Armazena configurações operacionais globais, como `require_post_approval`.
- `public.breeds`: Catálogo de raças por espécie, sincronizado automaticamente via triggers.
- `public.site_statistics`: Contadores globais do painel administrativo.
- `public.user_recovery_codes`: Armazenamento isolado e com hash criptográfico de códigos de recuperação de conta.
- `public.api_rate_limits`: Tabela de controle de taxa contra abusos de requisições.
- `public.post_reports`: Tabela de denúncias comunitárias de publicações.

## 2. Diagnóstico da Causa-Raiz do Erro PGRST201
- **Causa:** O PostgREST detectou múltiplas relações de Foreign Key entre as tabelas `public.posts` e `public.profiles`. Quando o frontend executa `.select('*, profiles(...)')`, o PostgREST não consegue desambiguar qual Foreign Key usar para montar o relacionamento embutido.
- **Origem das FKs Conflitantes:**
  1. A tabela `posts` possuía uma FK automática/legada `posts_user_id_fkey` apontando para `auth.users` ou `profiles`.
  2. A migração `20261026_performance_and_security_optimization.sql` adicionou uma segunda constraint explícita `posts_user_id_profiles_fkey` apontando de `posts.user_id` para `public.profiles(id)`.
  3. Adicionalmente, para registrar quem moderou um post, é necessário um campo `moderator_id` apontando para `public.profiles(id)`.
  4. Havendo mais de uma FK entre `posts` e `profiles`, o PostgREST exige desambiguação explícita por nome de constraint: `profiles:profiles!posts_author_id_fkey(...)`.

## 3. Diretriz do Novo `schema.sql`
- Unificar todas as 9 migrações em um único arquivo `schema.sql` na raiz do projeto.
- Padronizar nomes explícitos de Constraints:
  - `posts_author_id_fkey`: `FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE`
  - `posts_moderator_id_fkey`: `FOREIGN KEY (moderator_id) REFERENCES public.profiles(id) ON DELETE SET NULL`
- Adicionar coluna `moderator_id uuid` e `moderated_at timestamptz` na tabela `posts`.
- Garantir RLS blindado com `(select auth.uid())` e `(select public.is_admin())` para conversão em InitPlan de alta performance.
- Finalizar com `NOTIFY pgrst, 'reload schema';`.
