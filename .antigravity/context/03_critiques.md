# FASE 3: CRÍTICA TÉCNICA E AUDITORIA RED TEAM
**Subagente Líder:** `[SUBAGENTE: CRITICO_REDTEAM]`
**Alvo da Crítica:** `[SUBAGENTE: ARQUITETO_SOLUCOES]` (`.antigravity/context/02_solutions.md`)

---

## LOOP 1/3: Auditoria de Performance, Custo de Escrita e Sobrecarga de Índices
**Subagente Ativo:** `[SUBAGENTE: CRITICO_REDTEAM]`
**Loop Atual:** `[1/3]`
**Skill do GitHub Consultada:** `[https://github.com/donnemartin/system-design-primer -> Write Amplification & Index Overhead]` e `[https://github.com/goldbergyoni/nodebestpractices -> Performance Traps in Relational DBs]`

### 🚩 Ataques e Vulnerabilidades de Performance Apontadas nas Soluções:

1. **Ataque de Amplificação de Escrita por Excesso de Índices GIN:**
   - **Crítica:** O Arquiteto propôs criar 3 índices GIN simultâneos (`search_tsv`, `breed gin_trgm_ops`, `title gin_trgm_ops`) somados a 4 índices B-Tree (`posts_feed_status_created_idx`, `posts_feed_category_status_created_idx`, `posts_region_status_idx`, `posts_status_count_idx`).
   - **Gargalo:** Cada inserção ou atualização de post exigirá a atualização de **7 índices diferentes**, sendo 3 do tipo GIN (que exigem lock de B-Tree interna e reordenação de posting lists). Isso vai estrangular o throughput de escrita durante picos de adoção!
   - **Correção Exigida:**
     - Eliminar o índice `posts_title_trgm_idx` e manter apenas `search_tsv_idx` (GIN) para o texto consolidado + `breed_trgm_idx` para o autocomplete de raças. A coluna `search_tsv` já contém o título, tornando o índice avulso de título uma redundância inútil que só consome RAM e I/O de disco.
     - Unificar `posts_status_count_idx` no índice já existente `posts_feed_status_created_idx`.

2. **Risco de Invalidação de Cache por Truncamento em SWR:**
   - **Crítica:** Se o frontend mantiver um cache SWR na memória global (`FeedCacheStore`) sem vinculação de chave composta por filtros (`category:state:city:page`), alternar rapidamente entre abas de animais vai renderizar dados de cães na página de gatos por frações de segundo até o revalidate concluir.
   - **Correção Exigida:** A chave de cache DEVE ser determinística e incluir todos os parâmetros da query: `feed:${type}:${state}:${city}:${page}`.

---

## LOOP 2/3: Auditoria de Usabilidade, Abuso de Moderação (Mass Reporting) e Atrito
**Subagente Ativo:** `[SUBAGENTE: CRITICO_REDTEAM]`
**Loop Atual:** `[2/3]`
**Skill do GitHub Consultada:** `[https://github.com/alan2207/bulletproof-react -> UX Edge Cases]` e `[https://github.com/OWASP/CheatSheetSeries -> Denial of Service & Abuse Mitigation]`

### 🚩 Ataques e Vulnerabilidades de Usabilidade e Moderação:

1. **Vulnerabilidade de Negação de Serviço por Denúncias em Massa (Mass-Reporting DoS):**
   - **Crítica:** O trigger proposto pelo Arquiteto altera o post para `pending` (ocultando-o do site) assim que atinge 5 denúncias. Um atacante com 5 contas fakes (ou um bot criando contas com auto-confirmação ativada) pode derrubar o post de qualquer usuário legítimo em segundos!
   - **Correção Exigida:**
     - Uma denúncia nunca deve ocultar o post instantaneamente a menos que venha de usuários com tempo mínimo de conta ou que a taxa de denúncias seja ponderada.
     - A restrição `UNIQUE (post_id, reporter_id)` DEVE ser criada para que o mesmo usuário não consiga disparar múltiplas denúncias.
     - Limitar denúncias com Rate Limiting específico (máximo 3 denúncias por usuário por hora).
     - Posts de usuários verificados/antigos não devem ser auto-ocultados; apenas flagged para a fila do admin com prioridade alta.

2. **Falso Positivo na Compressão de Imagens no Cliente:**
   - **Crítica:** O Canvas API pode falhar silenciosamente ou gerar blobs corrompidos se a imagem contiver perfil de cor exótico (CMYK, HEIC de iPhones ou SVG malicioso).
   - **Correção Exigida:** Se `compressImageFile` falhar ou produzir um blob inválido, o código deve adotar *Graceful Degradation*, enviando o arquivo original se ele estiver dentro do limite de tamanho (ex.: < 5MB), acompanhado de verificação estrita de MIME type.

---

## LOOP 3/3: Auditoria de Segurança Ofensiva (Pentest Lógico e Blindagem de Contas)
**Subagente Ativo:** `[SUBAGENTE: CRITICO_REDTEAM]`
**Loop Atual:** `[3/3]`
**Skill do GitHub Consultada:** `[https://github.com/OWASP/CheatSheetSeries -> GraphQL/REST Authorization & IDOR Attacks]` e `[https://github.com/semgrep/semgrep-rules -> Security Best Practices]`

### 🚩 Ataques de Intrusão e Vazamento de Dados:

1. **Bypass de Moderação em Updates de Posts:**
   - **Crítica:** Se um usuário criar um post aprovado e depois alterar o texto para um anúncio fraudulento de venda de animais ou golpe financeiro com Pix, o trigger de update atual (`20261023_complete_production_hardening.sql`:106-128) valida apenas o `status`. Ele **não** reverte o status para `pending` caso campos sensíveis (`title`, `description`, `image_urls`) sejam substancialmente alterados quando a moderação prévia estiver ativada!
   - **Correção Exigida:** Se `require_post_approval` for `true`, qualquer edição significativa no conteúdo por um usuário não-admin DEVE colocar o post de volta em `pending` para reavaliação da moderação.

2. **Vazamento de Dados Privados de Contas via RLS em `public.profiles`:**
   - **Crítica:** O Arquiteto propôs uma view `public_profiles`, mas não revogou a leitura pública da tabela física `public.profiles`! Qualquer cliente malicioso chamando `supabase.from('profiles').select('email, created_at, birth_date')` ainda terá acesso aos dados confidenciais dos usuários através da Anon Key.
   - **Correção Exigida:**
     - Alterar a política de leitura de `public.profiles`: usuários só podem ler colunas sensíveis do seu próprio perfil (`auth.uid() = id`), enquanto o público só tem acesso a `id`, `full_name`, `username` e `avatar_url`.

3. **Injeção de Caracteres de Controle e Payload Bombs na Busca:**
   - **Crítica:** Termos como `labrador' & & | |` enviados diretamente para `to_tsquery` ou consultas PostgREST podem gerar erros 500 no banco ou quebrar o parser FTS.
   - **Correção Exigida:** A função de busca deve utilizar `websearch_to_tsquery('portuguese', ...)` ou `plainto_tsquery`, que sanitizam operadores booleanos e símbolos automaticamente sem disparar syntax errors.

---

## 🎯 Sumário das Correções Obrigatórias para a Fase 4:
1. Eliminar índices redundantes para manter o custo de escrita baixo.
2. Adicionar constraint `UNIQUE (post_id, reporter_id)` e rate limiting em denúncias.
3. Blindar update de posts para impedir alteração de conteúdo aprovado sem nova moderação.
4. Trancar colunas sensíveis em `public.profiles` contra raspagem de dados via Anon Key.
5. Usar `plainto_tsquery` / `websearch_to_tsquery` contra injeção de sintaxe de busca.
