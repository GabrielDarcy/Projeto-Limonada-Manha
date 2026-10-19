


do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'posts' and column_name = 'support_type'
  ) then
    alter table public.posts add column support_type text not null default 'adocao';
  end if;
end $$;

alter table public.posts drop constraint if exists posts_support_type_check;
alter table public.posts add constraint posts_support_type_check
  check (support_type in ('adocao', 'lar_temporario', 'apadrinhamento'));

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('active', 'in_process', 'adopted', 'banned'));

create index if not exists posts_support_type_idx 
  on public.posts (support_type, status);

create index if not exists posts_status_created_idx 
  on public.posts (status, created_at desc);

drop policy if exists "Posts ativos são públicos" on public.posts;
create policy "Posts ativos são públicos"
  on public.posts for select
  using (
    status in ('active', 'in_process', 'adopted')
    or auth.uid() = user_id
    or public.is_admin()
  );

comment on column public.posts.support_type is 'Finalidade do post: adocao (definitiva), lar_temporario (LT provisório) ou apadrinhamento (custos/castração)';
comment on column public.posts.status is 'Estado do animal: active (disponível), in_process (em processo/entrevista), adopted (adotado/concluído), banned (moderado)';
