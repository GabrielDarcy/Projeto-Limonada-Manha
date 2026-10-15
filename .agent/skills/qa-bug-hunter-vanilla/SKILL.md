---
name: qa-bug-hunter-vanilla
description: Auditoria completa de UI/UX, tradução de chaves cruas do banco de dados, formatação de booleanos, bloqueio de scroll do body e tratamento de estados vazios em Vanilla JS.
---

# QA Bug Hunter Vanilla Skill

Esta skill foca na identificação e correção metódica de falhas de usabilidade, dados não traduzidos e comportamentos indesejados de navegação em aplicações JavaScript Vanilla + HTML + CSS.

## Checklist de Auditoria e Correção

1. **Tradução e Humanização de Dados:**
   - **Nomes de Colunas/Chaves:** Nenhuma chave técnica em snake_case ou inglês (`age_group`, `special_needs`, `apartment_friendly`) deve ser exposta ao usuário. Todas devem passar por um mapa de tradução para Português amigável.
   - **Valores Booleanos:** `true` deve ser sempre renderizado como `"Sim"` e `false` como `"Não"`.
   - **Campos Incompatíveis com a Espécie:** Omitir campos que não façam sentido semântico (ex.: "Adapta-se a apartamento" para vacas, cavalos ou animais marinhos).

2. **Gerenciamento do Scroll do `body`:**
   - Ao abrir qualquer modal: adicionar classe `modal-open` no `document.body` e `document.documentElement` com `overflow: hidden;`.
   - Ao fechar o modal: remover a classe `modal-open` restaurando a rolagem natural da página.
   - O fechamento deve responder obrigatoriamente a:
     1. Clique no botão de fechar (X);
     2. Clique no backdrop escuro (fora do modal);
     3. Tecla `Escape` no teclado.

3. **Verificação de Truncamento e Distorção Visual:**
   - Testar títulos longos com `word-break: break-word` e respiros adequados para não colidirem com botões de fechar.
   - Garantir que tags, chips e badges tenham espaçamento e quebras adequadas.
   - Checar se containers de imagens mantêm proporção sem achatar ou esticar fotos de pets.

4. **Tratamento de Estados Vazios e Erros:**
   - Mensagens claras e amigáveis quando nenhum resultado for encontrado em filtros ou quando faltar informação no cadastro de um pet.
   - Não permitir que dados nulos (`null`, `undefined`) apareçam impressos como texto na interface.
