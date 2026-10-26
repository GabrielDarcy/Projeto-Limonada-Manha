# FRONTEND STATE — DIAGNÓSTICO E ENGENHARIA DE CLIENTE

## 1. Visão Geral da Stack de Frontend
- **Arquitetura:** Vanilla JavaScript Modular (`script.js`), CSS Moderno estruturado (`css/common.css`, `css/index.css`, `admin/admin.css`), Multi-Page Application (15 páginas HTML).
- **Gerenciamento de Estado:** Variáveis de módulo (`globalPostsMap`, `feedCurrentPage`), Cache Local (`localStorage`, `sessionStorage`, `CacheStorage` via Service Worker `sw.js`).
- **Comunicação com API:** Cliente Supabase (`supabase.js` / `getSupabaseClient()`).

## 2. Diagnóstico da Regressão Crítica de Performance no Cliente
### A. Cascata de Requisições Simultâneas sem Debounce ou AbortController
- **Arquivo:** `script.js` (Linhas 2609, 2683, 4730-4820)
- **Evidência:**
  - Na carga da página inicial (`index.html`), são disparadas simultaneamente `renderRecentPosts()` e `renderFeed()`, ambas consultando a tabela `posts` com `.select('*, profiles(...)')`.
  - Nenhuma requisição utiliza `AbortController`. Ao alternar filtros de estado ou categoria rapidamente, requisições antigas continuam competindo por rede e thread no Supabase, sobrescrevendo a interface em condição de corrida (*race condition*).
  - No formulário de busca e filtros, não há debounce implementado: a cada clique ou mudança de select, a query é imediatamente disparada ao banco.

### B. Over-fetching e Payloads Inflados no Feed
- **Arquivo:** `script.js` (Linhas 2609, 2683)
- **Código:** `.select('*, profiles(full_name, username, avatar_url)')`
- **Impacto:** O card do feed precisa apenas de 7 colunas (`id, title, animal_type, breed, state, city, image_urls, status, support_type, profiles(...)`). Atualmente, está baixando a descrição completa (que pode conter milhares de caracteres), todos os campos booleanos de convivência, contatos e dados desnecessários para a listagem inicial, sobrecarregando a transferência de bytes e atrasando o LCP (*Largest Contentful Paint*).

### C. Ausência de Skeletons / Feedback Visual de Carregamento
- **Arquivo:** `script.js` (Linha 2600)
- **Evidência:** `feedTarget.innerHTML = '';` limpa a tela instantaneamente antes da resposta do banco. O usuário fica olhando para um espaço em branco por 2 a 5 segundos enquanto o Postgres processa o Sequential Scan, transmitindo a sensação de que o site travou.

### D. Concorrência no Upload de Mídia e Criação de Posts
- **Arquivo:** `script.js` (Linhas 2426-2435)
- **Evidência:** O envio de múltiplas fotos é feito de forma sequencial com `for (const file of photoFiles) await uploadPostImage(...)` sem compressão client-side. Um usuário em 4G enviando 4 fotos de 5MB gasta 20MB de upload antes de chamar o `insert()`, com alto risco de timeout ou limite de conexões.

### E. Conflito de Caching no Service Worker
- **Arquivo:** `sw.js` (Linhas 35-70)
- **Evidência:** O Service Worker intercepta `script.js` com Stale-While-Revalidate em cache `pet-amor-v3`, mas as páginas HTML referenciam `script.js?v=56`. Mudanças no código podem ficar presas na versão antiga do cache se a estratégia de invalidação de query string não for estrita.
