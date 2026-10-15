-- ==============================================================================
-- Migração: Ajuste de Raças ("Não sei" vs "Vira-lata (SRD)") no Banco Supabase
-- Onde rodar: Painel do Supabase -> SQL Editor -> Nova Consulta -> Colar -> Run
-- ==============================================================================
--
-- Motivação:
-- Animais que biologicamente/comercialmente não possuem a denominação "Vira-lata"
-- (bovinos, equinos, aves, répteis, peixes, roedores, etc.) não devem utilizar
-- "Vira-lata (SRD)". Para eles, a primeira opção padrão de raça indeterminada
-- passa a ser oficialmente "Não sei". "Vira-lata (SRD)" é restrito a Cães e Gatos.
--
-- Esta migração:
-- 1. Garante que "Não sei" exista no catálogo da tabela public.breeds para
--    todas as categorias que não sejam Cão/Gato (Fazenda, Exótico, Marinho, Outro).
-- 2. Remove registros incorretos de "Vira-lata" atribuídos a espécies que não cães/gatos.
-- 3. Atualiza posts existentes de espécies não cão/gato com raça vira-lata para "Não sei".
-- 4. Garante que não haja restrições CHECK ou ENUM bloqueando o valor "Não sei".
-- 5. Atualiza a função get_active_breeds para retornar "Vira-lata (SRD)" no topo para cães/gatos,
--    e "Não sei" no topo para todas as demais espécies.
-- ==============================================================================

-- 1. Garante que as colunas aceitem texto livre e sem constraints indevidas
alter table public.posts drop constraint if exists posts_breed_check;
alter table public.posts drop constraint if exists posts_mother_breed_check;
alter table public.posts drop constraint if exists posts_father_breed_check;

-- 2. Insere a opção "Não sei" no catálogo para as categorias pertinentes
insert into public.breeds (animal_type, name) values
  ('Fazenda', 'Não sei'),
  ('Exótico', 'Não sei'),
  ('Marinho', 'Não sei'),
  ('Outro', 'Não sei')
on conflict (animal_type, name) do nothing;

-- 3. Limpeza: remove 'Vira-lata' de categorias que não sejam Cão ou Gato no catálogo
delete from public.breeds
 where animal_type not in ('Cachorro', 'Gato')
   and (name ilike '%vira-lata%' or name ilike '%srd%');

-- 4. Normaliza posts inconsistentes já salvos no banco de dados
update public.posts
   set breed = 'Não sei'
 where animal_type not in ('Cachorro', 'Gato')
   and (breed ilike '%vira-lata%' or breed ilike '%srd%');

update public.posts
   set mother_breed = 'Não sei'
 where animal_type not in ('Cachorro', 'Gato')
   and (mother_breed ilike '%vira-lata%' or mother_breed ilike '%srd%');

update public.posts
   set father_breed = 'Não sei'
 where animal_type not in ('Cachorro', 'Gato')
   and (father_breed ilike '%vira-lata%' or father_breed ilike '%srd%');

-- 5. Atualiza função RPC get_active_breeds com ordenação prioritária:
--    Cachorro e Gato -> "Vira-lata (SRD)" no topo (ordem 1).
--    Demais espécies -> "Não sei" no topo (ordem 1).
--    Demais raças em ordem alfabética (ordem 2).
create or replace function public.get_active_breeds(p_animal_type text)
returns table (breed text)
language sql
stable
security definer
set search_path = public
as $fn$
  select b.name as breed
    from public.breeds b
   where b.animal_type = p_animal_type
   order by
     case
       when p_animal_type in ('Cachorro', 'Gato') and b.name ilike '%vira-lata%' then 1
       when p_animal_type not in ('Cachorro', 'Gato') and b.name = 'Não sei' then 1
       else 2
     end,
     b.name collate "C" asc
$fn$;

grant execute on function public.get_active_breeds(text) to anon, authenticated;

-- 6. Trigger para manter novas raças cadastradas sincronizadas
create or replace function public.sincronizar_raca_do_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.breed is not null and trim(new.breed) <> '' and new.animal_type is not null then
    -- Não permite cadastrar 'vira-lata' para animais que não sejam cachorro ou gato
    if new.animal_type not in ('Cachorro', 'Gato') and (new.breed ilike '%vira-lata%' or new.breed ilike '%srd%') then
      new.breed := 'Não sei';
    end if;

    insert into public.breeds (animal_type, name)
    values (new.animal_type, trim(new.breed))
    on conflict (animal_type, name) do nothing;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_sincronizar_raca on public.posts;
create trigger trg_sincronizar_raca
  before insert or update of breed on public.posts
  for each row
  execute function public.sincronizar_raca_do_post();

-- 7. Consulta de verificação
select animal_type, name
from public.breeds
where name in ('Não sei', 'Vira-lata (SRD)')
order by animal_type, name;
