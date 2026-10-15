---
name: anti-ai-slop-ui
description: Elimina vícios de design de IA (AI UI slop), excesso de spans/divs desnecessários e substitui por HTML5 semântico limpo, tipografia sólida e design funcional.
---

# Anti-AI Slop UI & Semantic HTML Skill

Inspirada nos projetos de referência do GitHub (`LeoStehlik/no-slop-ui`, `Vanszs/Anti-AI-UI`, `anti-ui-slop/uizze`), esta skill estabelece diretrizes rigorosas para erradicar vícios comuns introduzidos por modelos de IA e recuperar código limpo, semântico e design profissional.

## 1. Eliminação de Excesso de `<span>` e `<div>` (Semantic HTML First)
- **Proibido usar `<span>` ou `<div>` quando existir elemento HTML5 semântico nativo**:
  - Parágrafos e frases descritivas pertencem a `<p>`.
  - Cabeçalhos, títulos de seções e cartões pertencem a `<h1>` até `<h6>`.
  - Destaques pertencem a `<strong>` (importância) ou `<em>` (ênfase).
  - Informações de data e hora pertencem a `<time>`.
  - Endereços, cidades e localizações pertencem a `<address>` ou `<p>`.
  - Listas de atributos chave-valor pertencem a `<dl>`, `<dt>`, `<dd>`.
  - Ações e links clicáveis pertencem a `<button type="button">` ou `<a href="...">`, NUNCA `<span onclick>` ou `<span>` dentro de botões sem propósito de styling estrito.
  - Tags/chips devem ser `<span class="badge">` apenas quando estritamente necessário como metadado curto; evitar aninhamento desnecessário como `<span><span>Texto</span></span>`.
- **Limpeza de texto puro**: se um elemento pai já é `<p>`, `<button>` ou `<a>`, não envolva cada fragmento de texto em `<span>` solto sem que haja estilização diferenciada obrigatória.

## 2. Erradicação de Vícios de Design de IA (Anti-AI Clichés & Slop)
- **Banir Textos com Gradiente Gratuito**:
  - Evitar `background-clip: text; -webkit-text-fill-color: transparent` e gradientes multicoloridos aplicados a títulos e badges sem identidade de marca. Utilizar cores sólidas com excelente contraste (WCAG AA).
- **Banir Glassmorphism Excessivo**:
  - Remover `backdrop-filter: blur(...)` e bordas translúcidas pesadas aplicadas indiscriminadamente em cards de conteúdo. Utilizar superfícies sólidas, limpas e com elevação natural (sombras suaves e bordas de 1px consistentes).
- **Controlar Arredondamento e Proporções**:
  - Evitar cantos hiper-arredondados (`border-radius: 9999px` ou `32px`) em cards estruturais de dados; usar raios consistentes e elegantes (8px a 16px).
- **Banir Animações Exageradas de IA**:
  - Eliminar pulos/flutuações exageradas no hover (`transform: translateY(-8px) scale(1.03)`). Manter transições sutis (`translateY(-2px)`, foco nítido e feedback de clique).
- **Humanização do Copywriting (Sem Jargões Robóticos de IA)**:
  - Eliminar clichês de texto de IA como "Descubra um universo mágico de carinho", "Acompanhe cada jornada de amor", emojis exagerados espalhados por todo canto (✨🚀🐾❤️ em cada frase). O texto deve ser direto, afetuoso, humano e objetivo.

## 3. Checklist de Execução
1. Auditar arquivos HTML e templates literais no JS em busca de `<span>` supérfluos e tags genéricas.
2. Trocar por elementos semânticos adequados (`<p>`, `<time>`, `<address>`, etc.).
3. Auditar arquivos CSS para simplificar seletores e remover gradientes/blur de IA desnecessários.
4. Validar acessibilidade e verificar que nenhum layout ou funcionalidade seja quebrado.
