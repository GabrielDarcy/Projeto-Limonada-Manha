
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imagens-adocao',
  'imagens-adocao',
  true,
  204800, -- 200 KB 
  array['image/webp'] 
)
on conflict (id) do update set
  public = true,
  file_size_limit = 204800,
  allowed_mime_types = array['image/webp'];

alter table storage.objects enable row level security;

drop policy if exists "Imagens de adocao publicas para leitura" on storage.objects;
create policy "Imagens de adocao publicas para leitura"
  on storage.objects for select
  using (bucket_id = 'imagens-adocao');

drop policy if exists "Upload autenticado em pasta propria" on storage.objects;
create policy "Upload autenticado em pasta propria"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'imagens-adocao'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Proprietario atualiza suas imagens de adocao" on storage.objects;
create policy "Proprietario atualiza suas imagens de adocao"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'imagens-adocao'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Proprietario ou admin deleta imagens de adocao" on storage.objects;
create policy "Proprietario ou admin deleta imagens de adocao"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'imagens-adocao'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );
