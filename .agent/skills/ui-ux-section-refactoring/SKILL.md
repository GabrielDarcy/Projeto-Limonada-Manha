---
name: ui-ux-section-refactoring
description: Consolidação visual e semântica de seções redundantes em interfaces web modernas, grids responsivos e navegação suave por âncoras.
---

# UI/UX Section Refactoring Skill

Esta skill orienta a consolidação semântica e visual de seções redundantes em landing pages e portais web, eliminando conteúdo duplicado e unificando propostas de valor correlatas em estruturas coesas e atraentes.

## Diretrizes de Unificação de Seções

1. **Fusão Conceitual e Semântica:**
   - Quando duas seções tratam de assuntos complementares (ex.: "Como ajudar" e "Apoie quem cuida"), agrupar as mensagens sob uma narrativa unificada:
     - Título principal convidativo e claro (ex.: *"Como Ajudar & Apoiar Quem Cuida"*).
     - Subtítulo humanizado que transmita propósito e impacto real.
     - Elementos de ação consolidados: doações financeiras/PIX, voluntariado, suporte a cuidadores e transparência em uma única arquitetura de informação.

2. **Hierarquia Visual e Grid Responsivo:**
   - Usar um grid balanceado (`display: grid` com `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` ou layout split 2 colunas no desktop) para dar visibilidade equilibrada às diferentes formas de contribuição.
   - Preservar micro-interações, tags de destaque (eyebrows/badges) e CTAs contrastantes.

3. **Manutenção de Âncoras e Acessibilidade:**
   - Manter a âncora principal (`id="ajuda"`) no elemento consolidado para não quebrar links existentes ou favoritos salvos por usuários.
   - Se links antigos apontavam para `#parceiros`, atualizar todos os links internos no Header e Footer para que apontem para a âncora unificada `#ajuda`.
   - Garantir que a navegação por teclado (`Tab`, `Skip link`) e rolagem suave (`scroll-behavior: smooth`) continuem funcionando fluidamente.
