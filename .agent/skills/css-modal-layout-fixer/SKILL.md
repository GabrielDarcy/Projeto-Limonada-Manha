---
name: css-modal-layout-fixer
description: Correção de modais responsivos em CSS puro (Flexbox/Grid), controle de max-height, overflow-y, posicionamento de imagem (object-fit, aspect-ratio) e prevenção de corte de elementos.
---

# CSS Modal Layout Fixer Skill

Esta skill estabelece as melhores práticas para a estruturação e estilização de janelas modais em CSS puro (sem bibliotecas de terceiros), assegurando responsividade perfeita, rolagem fluida e proporcionalidade de mídia.

## Regras de Estrutura e Layout

1. **Backdrop e Posicionamento Centralizado:**
   - O container externo do modal deve cobrir a viewport inteira com `position: fixed; inset: 0; z-index: 1000;`.
   - Utilizar Flexbox para centralização confiável:
     ```css
     .modal-overlay {
       position: fixed;
       inset: 0;
       z-index: 1000;
       display: flex;
       align-items: center;
       justify-content: center;
       padding: 24px;
       box-sizing: border-box;
     }
     ```

2. **Limites de Altura e Overflow:**
   - **Container do Card (.modal-content):** Deve ter `max-height: 85vh` (ou `90vh`), `overflow: hidden;` e `border-radius` bem definido. O container como um todo NÃO deve rolar.
   - **Coluna de Imagem (Esquerda no Desktop):**
     - Ocupa largura equilibrada (entre `45%` e `50%`).
     - `height: 100%`, `max-height: 85vh`.
     - Utilizar `object-fit: contain;` com fundo escuro neutro ou `object-fit: cover;` com altura restrita para evitar zoom excessivo ("efeito microscópio") em fotos verticais ou horizontais.
   - **Coluna de Conteúdo (Direita no Desktop):**
     - Deve conter todo o texto, tags e informações adicionais.
     - `overflow-y: auto;` com `max-height: 85vh;` dedicado.
     - `padding: 32px 28px;` com respiro superior para garantir que títulos longos nunca comecem cortados.

3. **Botão de Fechamento (X):**
   - Posicionado com clareza em `position: absolute; top: 16px; right: 16px; z-index: 20;`.
   - Fundo com alto contraste, formato circular, tamanho de toque mínimo (`40px x 40px`), acessível por teclado e foco visível.

4. **Responsividade Mobile (`@media (max-width: 768px)`):**
   - Transicionar de layout lado a lado para coluna única (`flex-direction: column`).
   - A imagem fica no topo com altura fixa ou controlada (`min-height: 250px; max-height: 300px; width: 100%;`).
   - A coluna de conteúdo fica abaixo com rolagem interna (`overflow-y: auto; max-height: calc(90vh - 270px);`).
