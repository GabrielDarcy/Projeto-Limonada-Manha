
alter table public.posts
  add column if not exists lt_duration text,
  add column if not exists lt_costs_covered text,
  add column if not exists lt_home_requirements text,
  add column if not exists sponsorship_purpose text,
  add column if not exists sponsorship_goal text,
  add column if not exists sponsorship_pix text;

alter table public.posts drop constraint if exists posts_lt_duration_check;
alter table public.posts add constraint posts_lt_duration_check
  check (lt_duration is null or length(lt_duration) <= 100);

alter table public.posts drop constraint if exists posts_lt_costs_check;
alter table public.posts add constraint posts_lt_costs_check
  check (lt_costs_covered is null or length(lt_costs_covered) <= 150);

alter table public.posts drop constraint if exists posts_lt_home_check;
alter table public.posts add constraint posts_lt_home_check
  check (lt_home_requirements is null or length(lt_home_requirements) <= 200);

alter table public.posts drop constraint if exists posts_sponsorship_purpose_check;
alter table public.posts add constraint posts_sponsorship_purpose_check
  check (sponsorship_purpose is null or length(sponsorship_purpose) <= 150);

alter table public.posts drop constraint if exists posts_sponsorship_goal_check;
alter table public.posts add constraint posts_sponsorship_goal_check
  check (sponsorship_goal is null or length(sponsorship_goal) <= 80);

alter table public.posts drop constraint if exists posts_sponsorship_pix_check;
alter table public.posts add constraint posts_sponsorship_pix_check
  check (sponsorship_pix is null or length(sponsorship_pix) <= 120);

comment on column public.posts.lt_duration is 'Tempo estimado necessário para acolhimento em Lar Temporário (ex: Até 1 mês, A combinar)';
comment on column public.posts.lt_costs_covered is 'Quais custos são cobertos pelo protetor/ONG no Lar Temporário (ração, veterinário, etc)';
comment on column public.posts.lt_home_requirements is 'Requisitos da moradia do acolhedor temporário (ex: quintal murado, telas)';
comment on column public.posts.sponsorship_purpose is 'Finalidade principal da ajuda financeira/apadrinhamento (castração, medicação, cirurgia)';
comment on column public.posts.sponsorship_goal is 'Meta ou valor sugerido para apadrinhamento (ex: R$ 150,00)';
comment on column public.posts.sponsorship_pix is 'Chave PIX voluntária informada pelo protetor para contribuição financeira direta';
