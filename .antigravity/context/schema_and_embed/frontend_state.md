# Estado do Frontend (JavaScript / UI de Moderação e Feed)

## 1. Mapeamento de Queries com Embed de Profiles
1. **Fila de Moderação de Posts Pendentes (`renderPendingPostsAdmin`):**
   - Arquivo: `script.js` (linha ~1271)
   - Query anterior quebrada: `.select('*, profiles(full_name, email, username)')`
   - Erro gerado: `PGRST201: Could not embed because more than one relationship was found for 'posts' and 'profiles'`
   - Correção necessária: `.select('*, profiles:profiles!posts_author_id_fkey(full_name, email, username)')`

2. **Constante Global de Colunas do Card de Feed (`POST_CARD_COLUMNS`):**
   - Arquivo: `script.js` (linha ~2606)
   - Query anterior: `'id, title, animal_type, breed, state, city, image_urls, status, support_type, created_at, profiles(full_name, username, avatar_url)'`
   - Correção necessária: `'id, title, animal_type, breed, state, city, image_urls, status, support_type, created_at, profiles:profiles!posts_author_id_fkey(full_name, username, avatar_url)'`

3. **Modal de Detalhes da Publicação (`openAdoptionModal`):**
   - Arquivo: `script.js` (linha ~3563)
   - Query anterior: `.select('*, profiles(full_name, username, avatar_url)')`
   - Correção necessária: `.select('*, profiles:profiles!posts_author_id_fkey(full_name, username, avatar_url)')`

4. **Verificação de Post Compartilhado via URL (`checkSharedPostOnLoad`):**
   - Arquivo: `script.js` (linha ~4238)
   - Query anterior: `.select('*, profiles(full_name, username, avatar_url)')`
   - Correção necessária: `.select('*, profiles:profiles!posts_author_id_fkey(full_name, username, avatar_url)')`

## 2. Preservação de Compatibilidade com a UI
- O uso do alias de relacionamento do PostgREST `profiles:profiles!posts_author_id_fkey(...)` faz com que o JSON retornado continue populando o objeto sob a chave `post.profiles`.
- Isso garante que chamadas existentes como `renderAuthorBar(post.profiles)` e acessos a `post.profiles.full_name`, `post.profiles.username` e `post.profiles.avatar_url` continuem funcionando sem alteração nos templates de renderização.
