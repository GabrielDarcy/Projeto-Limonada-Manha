---
name: supabase-data-sync
description: Sincronização de listas estáticas/dinâmicas no JavaScript com filtros de busca e constraints/enums do banco de dados no Supabase.
---

# Supabase Data Sync Skill

Esta skill orienta a sincronização consistente entre regras de negócio, dados estáticos locais (catálogos de raças, espécies, categorias) e esquemas no Supabase (tabelas, enums, constraints `CHECK`, triggers e RPCs).

## Princípios Fundamentais

1. **Consistência de Tipos e Opções:**
   - Valores selecionados em `<select>` no frontend devem corresponder exatamente aos valores esperados pelas queries (`.eq()`, `.ilike()`) e aceitos pelas colunas do banco de dados.
   - Para espécies como cães e gatos, o valor padrão para animais sem raça definida é `"Vira-lata (SRD)"`.
   - Para espécies que biologicamente ou comercialmente não são "Vira-lata" (bovinos, equinos, aves, répteis, marinhos, etc.), o valor padrão/indeterminado é `"Não sei"`.

2. **Hierarquia de Carregamento (Resiliência):**
   - **Cache Local / Catálogo Base:** Fornece opções instantâneas para evitar tela piscando ou selects vazios enquanto a rede responde.
   - **RPC / Tabela Supabase (`get_active_breeds`):** Busca catálogo completo e enriquece com raças cadastradas dinamicamente.
   - **Fallback Graceful:** Se o Supabase falhar ou estiver offline, a aplicação utiliza o catálogo local sem gerar erros de console.

3. **Construção de Filtros e Queries:**
   - Ao filtrar por raça no Supabase:
     ```javascript
     if (f.breed) {
       // Permite correspondência flexível com ilike ou eq
       query = query.ilike('breed', `%${f.breed}%`);
     }
     ```
   - Valores "Todos" ou vazios (`""`) não devem ser enviados como filtro para o Supabase (para não restringir desnecessariamente o resultado).

4. **Triggers e Migrações no Banco de Dados:**
   - Garantir que tabelas como `public.breeds` e triggers de sincronização (`trg_sincronizar_raca`) aceitem e integrem novos valores padrão como `"Não sei"`.
   - Verificar ausência de restrições rígidas (`CHECK (breed IN (...))`) que causem erro 400 (`Bad Request`) no insert/update.
