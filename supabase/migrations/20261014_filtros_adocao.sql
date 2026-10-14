-- filtros de adoção no estilo petfinder, adaptados pro brasil
-- onde rodar: painel do supabase -> sql editor -> new query -> colar -> run
--
-- por que estas colunas: hoje posts tem animal_type, breed, size, state, city,
-- status. faltava o que o adotante brasileiro realmente pergunta: castrado,
-- vacinado, vermifugado, e se o animal convive com criança, cachorro ou gato.
--
-- regra de ouro das colunas de compatibilidade: sao nullaveis de proposito.
--   true  = convive bem
--   false = nao convive
--   null  = quem publicou nao informou
-- o filtro so esconde o animal quando o valor e explicitamente false. sem isso,
-- exigir "convive com crianca" apagaria todo anuncio que nao preencheu o campo,
-- reduzindo o alcance dos pets em vez de ajudar a adocao.

-- 1. faixa de idade
alter table public.posts add column if not exists age_group text;
alter table public.posts drop constraint if exists posts_age_group_check;
alter table public.posts add constraint posts_age_group_check
  check (age_group is null or age_group in ('Filhote', 'Jovem', 'Adulto', 'Idoso'));

-- 2. sexo
alter table public.posts add column if not exists gender text;
alter table public.posts drop constraint if exists posts_gender_check;
alter table public.posts add constraint posts_gender_check
  check (gender is null or gender in ('Macho', 'Fêmea'));

-- 3. saude e cuidado
alter table public.posts add column if not exists neutered boolean;
alter table public.posts add column if not exists vaccinated boolean;
alter table public.posts add column if not exists dewormed boolean;
alter table public.posts add column if not exists special_needs boolean;

-- 4. convivencia (nullavel, ver regra no topo)
alter table public.posts add column if not exists good_with_kids boolean;
alter table public.posts add column if not exists good_with_dogs boolean;
alter table public.posts add column if not exists good_with_cats boolean;

-- 5. temperamento
alter table public.posts add column if not exists energy_level text;
alter table public.posts drop constraint if exists posts_energy_level_check;
alter table public.posts add constraint posts_energy_level_check
  check (energy_level is null or energy_level in ('Calmo', 'Moderado', 'Agitado'));

alter table public.posts add column if not exists apartment_friendly boolean;

-- 6. indices para os filtros mais usados
create index if not exists posts_filtro_principal_idx
  on public.posts (animal_type, status, state, city);
create index if not exists posts_filtro_idade_idx
  on public.posts (animal_type, status, age_group);
create index if not exists posts_filtro_sexo_idx
  on public.posts (animal_type, status, gender);
create index if not exists posts_filtro_cuidado_idx
  on public.posts (animal_type, status, neutered, vaccinated);

-- 7. normaliza o que ja existe: garante que status invalido nao vire anuncio sumido
update public.posts set status = 'active' where status is null or status = '';

-- 8. backfill de idade a partir da data de nascimento quando houver
alter table public.posts add column if not exists birth_date date;

-- 9. conferencia: colunas criadas
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'posts'
  and column_name in ('age_group','gender','neutered','vaccinated','dewormed',
                      'special_needs','good_with_kids','good_with_dogs',
                      'good_with_cats','energy_level','apartment_friendly','birth_date')
order by column_name;

-- se precisar desfazer:
-- alter table public.posts drop column if exists age_group, drop column if exists gender,
--   drop column if exists neutered, drop column if exists vaccinated, drop column if exists
--   dewormed, drop column if exists special_needs, drop column if exists good_with_kids,
--   drop column if exists good_with_dogs, drop column if exists good_with_cats,
--   drop column if exists energy_level, drop column if exists apartment_friendly,
--   drop column if exists birth_date;
