-- catalogo de racas e especies, para o filtro nao depender de ja existir anuncio
-- onde rodar: painel do supabase -> sql editor -> nova query -> colar -> run
--
-- por que isto existe: o filtro de raca puxava racas de get_active_breeds, que so
-- devolve o que ja foi publicado. com o banco vazio o filtro ficava sem opcao
-- nenhuma, e raca nova so aparecia se alguem ja tivesse anunciado aquele animal.
-- agora o catalogo vem do banco e o anuncio so enriquece ele.

create table if not exists public.breeds (
  id          bigserial primary key,
  animal_type text not null,
  species     text,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (animal_type, name)
);

alter table public.breeds enable row level security;

-- leitura liberada, escrita so por quem administra
drop policy if exists "breeds_leitura_publica" on public.breeds;
create policy "breeds_leitura_publica"
  on public.breeds for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.breeds from anon, authenticated;
grant select on public.breeds to anon, authenticated;
grant usage, select on sequence public.breeds_id_seq to service_role;
grant all on public.breeds to service_role;

-- popula o catalogo base (cachorro, gato, fazenda, exotico, marinho).
-- on conflict do nothing: rodar de novo nao quebra nem duplica
insert into public.breeds (animal_type, name) values
('Cachorro','Affenpinscher'),('Cachorro','Afghan Hound'),('Cachorro','Airedale Terrier'),
('Cachorro','Akita'),('Cachorro','Akita Americano'),('Cachorro','American Bully'),
('Cachorro','American Staffordshire Terrier'),('Cachorro','Australian Cattle Dog'),
('Cachorro','Australian Shepherd'),('Cachorro','Basenji'),('Cachorro','Basset Hound'),
('Cachorro','Beagle'),('Cachorro','Bearded Collie'),('Cachorro','Bernese Mountain Dog'),
('Cachorro','Bichon Frisé'),('Cachorro','Bloodhound'),('Cachorro','Border Collie'),
('Cachorro','Boston Terrier'),('Cachorro','Boxer'),('Cachorro','Buldogue Americano'),
('Cachorro','Buldogue Campeiro'),('Cachorro','Buldogue Francês'),('Cachorro','Buldogue Inglês'),
('Cachorro','Bull Terrier'),('Cachorro','Bullmastiff'),('Cachorro','Cane Corso'),
('Cachorro','Cavalier King Charles Spaniel'),('Cachorro','Chihuahua'),('Cachorro','Chow Chow'),
('Cachorro','Cocker Spaniel Americano'),('Cachorro','Cocker Spaniel Inglês'),('Cachorro','Collie'),
('Cachorro','Cão de Crista Chinês'),('Cachorro','Cão de água português'),
('Cachorro','Cão de montanha dos Pirineus'),('Cachorro','Dachshund'),('Cachorro','Dálmata'),
('Cachorro','Doberman'),('Cachorro','Dogo Argentino'),('Cachorro','Dogue Alemão'),
('Cachorro','Dogue de Bordeaux'),('Cachorro','Fila Brasileiro'),('Cachorro','Fox Paulistinha'),
('Cachorro','Golden Retriever'),('Cachorro','Greyhound'),('Cachorro','Griffon de Bruxelas'),
('Cachorro','Husky Siberiano'),('Cachorro','Jack Russell Terrier'),('Cachorro','Labrador Retriever'),
('Cachorro','Lhasa Apso'),('Cachorro','Lulu da Pomerânia'),('Cachorro','Malamute do Alasca'),
('Cachorro','Maltês'),('Cachorro','Mastiff'),('Cachorro','Norfolk Terrier'),
('Cachorro','Norwich Terrier'),('Cachorro','Old English Sheepdog'),('Cachorro','Papillon'),
('Cachorro','Pastor Alemão'),('Cachorro','Pastor Australiano'),('Cachorro','Pastor Belga'),
('Cachorro','Pastor Branco Suíço'),('Cachorro','Pastor de Shetland'),('Cachorro','Pequinês'),
('Cachorro','Pinscher'),('Cachorro','Pit Bull'),('Cachorro','Pointer Inglês'),('Cachorro','Poodle'),
('Cachorro','Pug'),('Cachorro','Rottweiler'),('Cachorro','Samoieda'),('Cachorro','Schnauzer'),
('Cachorro','Setter Irlandês'),('Cachorro','Shar-Pei'),('Cachorro','Shiba Inu'),
('Cachorro','Shih Tzu'),('Cachorro','Staffordshire Bull Terrier'),('Cachorro','São Bernardo'),
('Cachorro','Terrier Brasileiro'),('Cachorro','Terrier Escocês'),('Cachorro','Vira-lata (SRD)'),
('Cachorro','Vizsla'),('Cachorro','Weimaraner'),('Cachorro','Welsh Corgi'),
('Cachorro','West Highland White Terrier'),('Cachorro','Whippet'),('Cachorro','Yorkshire Terrier'),

('Gato','Abissínio'),('Gato','American Curl'),('Gato','American Shorthair'),
('Gato','American Wirehair'),('Gato','Angorá'),('Gato','Azul Russo'),('Gato','Balinês'),
('Gato','Bengal'),('Gato','Birmanês'),('Gato','Bombaim'),('Gato','British Longhair'),
('Gato','British Shorthair'),('Gato','Burmês'),('Gato','Chartreux'),('Gato','Cornish Rex'),
('Gato','Devon Rex'),('Gato','Exótico de Pelo Curto'),('Gato','Himalaio'),('Gato','Khao Manee'),
('Gato','LaPerm'),('Gato','Maine Coon'),('Gato','Manx'),('Gato','Munchkin'),('Gato','Nebelung'),
('Gato','Norueguês da Floresta'),('Gato','Oriental'),('Gato','Persa'),('Gato','Peterbald'),
('Gato','Ragdoll'),('Gato','Sagrado da Birmânia'),('Gato','Savannah'),('Gato','Scottish Fold'),
('Gato','Scottish Straight'),('Gato','Selkirk Rex'),('Gato','Siamês'),('Gato','Siberiano'),
('Gato','Singapura'),('Gato','Somali'),('Gato','Sphynx'),('Gato','Tonquinês'),
('Gato','Turco Van'),('Gato','Vira-lata (SRD)'),

('Fazenda','Abelha'),('Fazenda','Alpaca'),('Fazenda','Asinino'),('Fazenda','Avestruz'),
('Fazenda','Bode'),('Fazenda','Boi'),('Fazenda','Boi Angus'),('Fazenda','Boi Brahman'),
('Fazenda','Boi Hereford'),('Fazenda','Boi Nelore'),('Fazenda','Búfalo'),('Fazenda','Cabra'),
('Fazenda','Cabra Anglonubiana'),('Fazenda','Cabra Boer'),('Fazenda','Cabra Saanen'),
('Fazenda','Cabra Toggenburg'),('Fazenda','Cavalo'),('Fazenda','Cavalo Campolina'),
('Fazenda','Cavalo Crioulo'),('Fazenda','Cavalo Mangalarga'),('Fazenda','Cavalo Quarto de Milha'),
('Fazenda','Cavalo Árabe'),('Fazenda','Codorna'),('Fazenda','Coelho'),('Fazenda','Coelho Angorá'),
('Fazenda','Coelho Mini Lop'),('Fazenda','Coelho Nova Zelândia'),('Fazenda','Galinha'),
('Fazenda','Galinha caipira'),('Fazenda','Ganso'),('Fazenda','Gado de leite'),('Fazenda','Jumento'),('Fazenda','Lhama'),
('Fazenda','Marreco'),('Fazenda','Mula'),('Fazenda','Ovelha'),('Fazenda','Ovelha Dorper'),
('Fazenda','Ovelha Hampshire Down'),('Fazenda','Ovelha Santa Inês'),('Fazenda','Pato'),
('Fazenda','Pavão'),('Fazenda','Peru'),('Fazenda','Porco'),('Fazenda','Porco caipira'),
('Fazenda','Pônei'),('Fazenda','Vaca'),('Fazenda','Vaca Girolando'),('Fazenda','Vaca Holandesa'),
('Fazenda','Vaca Jersey'),('Fazenda','Vaca Nelore'),('Fazenda','Égua'),

('Exótico','Agapornis'),('Exótico','Axolote'),('Exótico','Cacatua'),('Exótico','Calopsita'),
('Exótico','Camaleão'),('Exótico','Canário'),('Exótico','Chinchila'),('Exótico','Cobra'),
('Exótico','Cobra-do-milho'),('Exótico','Cágado'),('Exótico','Degú'),('Exótico','Dragão-barbudo'),
('Exótico','Escorpião'),('Exótico','Esquilo-da-Mongólia'),('Exótico','Furão'),
('Exótico','Gecko-leopardo'),('Exótico','Gerbil'),('Exótico','Hamster'),
('Exótico','Hamster chinês'),('Exótico','Hamster sírio'),('Exótico','Iguana'),('Exótico','Jabuti'),
('Exótico','Jabuti-piranga'),('Exótico','Jiboia'),('Exótico','Lagartixa'),('Exótico','Lagarto'),
('Exótico','Maritaca'),('Exótico','Mini pig'),('Exótico','Ouriço-cacheiro'),
('Exótico','Periquito'),('Exótico','Periquito-australiano'),('Exótico','Pogona'),
('Exótico','Porquinho-da-índia'),('Exótico','Rato'),('Exótico','Rato twister'),
('Exótico','Sagui'),('Exótico','Salamandra'),('Exótico','Serpente'),('Exótico','Tarântula'),
('Exótico','Tartaruga'),('Exótico','Teiú'),('Exótico','Tigre-d''água'),('Exótico','Tritão'),('Exótico','Outro'),

('Marinho','Anêmona-do-mar'),('Marinho','Baiacu'),('Marinho','Camarão'),
('Marinho','Caranguejo'),('Marinho','Cavalo-marinho'),('Marinho','Coral'),
('Marinho','Coral-cérebro'),('Marinho','Donzela'),('Marinho','Estrela-do-mar'),
('Marinho','Lagosta'),('Marinho','Lula'),('Marinho','Medusa'),('Marinho','Molusco'),
('Marinho','Ostra'),('Marinho','Ouriço-do-mar'),('Marinho','Peixe'),('Marinho','Peixe-anjo'),
('Marinho','Peixe-betta'),('Marinho','Peixe-cirurgião'),('Marinho','Peixe-dourado'),
('Marinho','Peixe-leão'),('Marinho','Peixe-palhaço'),('Marinho','Peixe-papagaio'),
('Marinho','Pepino-do-mar'),('Marinho','Polvo'),('Marinho','Raia'),('Marinho','Sardinha'),
('Marinho','Tartaruga-marinha'),('Marinho','Tartaruga-verde'),('Marinho','Tubarão'),
('Marinho','Água-viva'),('Marinho','Outro')
on conflict (animal_type, name) do nothing;

-- funcao que o site chama: devolve o catalogo daquele tipo.
-- mantem o formato { breed: 'nome' } que o front ja esperava.
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
   order by b.name
$fn$;

grant execute on function public.get_active_breeds(text) to anon, authenticated;

-- racas que apareceram em anuncios mas nao estao no catalogo entram sozinhas.
-- util quando alguem publica uma raca que ninguem previu.
create or replace function public.sincronizar_raca_do_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.breed is not null and new.breed <> '' and new.animal_type is not null then
    insert into public.breeds (animal_type, name)
    values (new.animal_type, trim(new.breed))
    on conflict (animal_type, name) do nothing;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_sincronizar_raca on public.posts;
create trigger trg_sincronizar_raca
  after insert or update of breed on public.posts
  for each row
  execute function public.sincronizar_raca_do_post();

-- conferencia: quantidade por tipo (esperado: cachorro 88, gato 42, fazenda 49,
-- exotico 43, marinho 31)
select animal_type, count(*) as racas
from public.breeds
group by animal_type
order by animal_type;
