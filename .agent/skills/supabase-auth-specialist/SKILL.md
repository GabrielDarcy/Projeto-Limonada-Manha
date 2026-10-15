---
name: supabase-auth-specialist
description: Diagnóstico e correção de fluxos de autenticação Supabase, login híbrido (E-mail ou Username), RLS e tratamento de erros amigáveis.
---

# Supabase Auth Specialist Skill

Esta skill guia a implementação e auditoria de fluxos de autenticação robustos utilizando a API JavaScript do Supabase (@supabase/supabase-js) em ambientes Vanilla JS, com foco em login híbrido (E-mail ou Nome de Usuário), segurança RLS e mensagens de erro transparentes.

## Princípios de Autenticação Híbrida (E-mail / Username)

1. **Limitação Nativa do Supabase:**
   - O endpoint `supabase.auth.signInWithPassword({ email, password })` aceita nativamente apenas endereços de e-mail (ou telefones se habilitado SMS). Ele **não** aceita nomes de usuário (`username`) diretamente no parâmetro `email`.

2. **Fluxo Híbrido Seguro de Resolução de Identidade:**
   - Identificar a entrada do usuário:
     - Se contiver `@`: Tratar como e-mail direto (`identifier.trim().toLowerCase()`).
     - Se NÃO contiver `@`: Tratar como `username` (remover `@` inicial se fornecido, aplicar `.trim().toLowerCase()`).
   - **Resolução via RPC com `SECURITY DEFINER`:**
     - Uma consulta direta a `public.profiles` por usuários anônimos pode falhar se a tabela estiver protegida por RLS ou se a coluna `email` não for pública por questões de privacidade.
     - A melhor prática recomendada é criar uma função RPC no Postgres:
       ```sql
       create or replace function public.get_email_by_username(p_username text)
       returns text
       language sql
       security definer
       set search_path = public
       as $$
         select email from public.profiles
          where lower(username) = lower(trim(p_username))
          limit 1;
       $$;
       grant execute on function public.get_email_by_username(text) to anon, authenticated;
       ```
     - Caso o RPC retorne nulo, a aplicação deve interromper o fluxo com mensagem clara: `"Nenhuma conta encontrada com este nome de usuário."`.
     - Caso encontre o e-mail, invocar `signInWithPassword({ email: foundEmail, password })`.

3. **Mapeamento e Tradução Precisa de Erros:**
   - Nunca expor mensagens cruas da API em inglês (`Invalid login credentials`, `Email not confirmed`).
   - Mapear os cenários mais comuns:
     - `Email not confirmed` $\rightarrow$ *"Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada e spam para ativar a conta."*
     - `Invalid login credentials` $\rightarrow$ *"E-mail/usuário ou senha incorretos. Verifique suas credenciais e tente novamente."*
     - `User not found` $\rightarrow$ *"Não encontramos nenhuma conta com estes dados."*
     - `Too many requests` / `rate limit` $\rightarrow$ *"Muitas tentativas em pouco tempo. Aguarde alguns instantes antes de tentar novamente."*

4. **Gerenciamento de Formulário e Sessão:**
   - Sempre executar `event.preventDefault()` imediatamente no manipulador de submit.
   - Desabilitar o botão de envio durante a requisição com feedback visual (`Entrando...`).
   - Persistir a sessão localmente (quando aplicável) e sincronizar o estado da UI com `updateHomeUserActions()`.
