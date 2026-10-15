---
name: vanilla-js-state-dom
description: Gerenciamento de estado limpo em JS puro, reset completo de filtros e formulários, sincronização de DOM e re-renderização imediata de feeds.
---

# Vanilla JS State & DOM Skill

Esta skill estabelece diretrizes para manipulação de formulários, filtros e estado sem frameworks (Vanilla JavaScript), garantindo que eventos de reset operem de forma confiável e síncrona com os elementos de UI (nativos e customizados).

## Padrões de Gerenciamento de Filtros e Busca

1. **Ciclo Completo de Reset (Limpeza de Filtros):**
   - Um botão "Limpar Filtros" deve executar todas as seguintes etapas em ordem:
     1. **Reset dos Elementos Nativos:**
        - Percorrer todos os `<select>` do painel de filtros e definir `element.value = ''` (ou a primeira opção vazia).
        - Percorrer inputs de texto (`input[type="text"]`, `input[type="search"]`) e definir `element.value = ''`.
        - Desmarcar checkboxes (`input[type="checkbox"].checked = false`).
     2. **Sincronização de Componentes Customizados:**
        - Em aplicações que estilizam selects com UI personalizada (ex: `.custom-select`), disparar o evento customizado ou chamar explicitamente a função de sincronização:
          ```javascript
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.dispatchEvent(new Event('customselect:refresh', { bubbles: true }));
          ```
     3. **Limpeza de Armazenamento / Estado Global:**
        - Limpar filtros salvos em `sessionStorage` ou `localStorage` para evitar que a página restaure filtros antigos ao atualizar.
        - Limpar chips de filtros ativos (`#filtrosAtivos`).
     4. **Disparo Imediato da Nova Consulta:**
        - Chamar imediatamente a função de carregamento do feed (`renderCategoryFeed()`, `renderFeed()`) sem debounce, garantindo resposta instantânea ao usuário.

2. **Prevenção de Perda de Event Listeners:**
   - Registrar os listeners de botões estáticos no carregamento (`DOMContentLoaded` ou `initializePage`), evitando amarrar eventos dentro de templates re-renderizados repetidamente.
   - Usar delegação de eventos (`closest()`) para elementos dinâmicos (como chips de filtros ativos que são gerados sob demanda).

3. **Atualização Dinâmica de Campos Dependentes:**
   - Ao resetar o estado de filtros que possuem dependências hierárquicas (ex: Estado $\rightarrow$ Cidades, Tipo $\rightarrow$ Raças):
     - Desabilitar selects dependentes se o pai estiver vazio.
     - Recarregar a lista padrão de opções no select de raça/espécie.
