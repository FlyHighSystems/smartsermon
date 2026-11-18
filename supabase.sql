-- ============================================================
-- SmartSermon — banco de dados no Supabase
-- Cole tudo no SQL Editor do seu projeto e clique em "Run".
-- Pode rodar de novo sem problema (o script é idempotente).
-- ============================================================

-- Relógio do servidor em milissegundos (usado como cursor de sincronização)
create or replace function public.ss_now_ms() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function public.ss_touch() returns trigger
language plpgsql as $$
begin
  new.server_updated := public.ss_now_ms();
  return new;
end $$;

-- Ministrações (uma linha por ministração; o conteúdo vai em JSON)
create table if not exists public.sermons (
  user_id        uuid    not null default auth.uid() references auth.users(id) on delete cascade,
  id             text    not null,
  data           jsonb   not null default '{}'::jsonb,
  updated_at     bigint  not null,              -- quando foi editada (relógio do aparelho)
  deleted        boolean not null default false, -- exclusões também sincronizam
  server_updated bigint  not null default public.ss_now_ms(),
  primary key (user_id, id)
);
create index if not exists sermons_sync_idx on public.sermons (user_id, server_updated, id);
drop trigger if exists sermons_touch on public.sermons;
create trigger sermons_touch before insert or update on public.sermons
  for each row execute function public.ss_touch();

-- Cadernos, seções e tipos de bloco do usuário
create table if not exists public.user_meta (
  user_id        uuid   primary key default auth.uid() references auth.users(id) on delete cascade,
  data           jsonb  not null default '{}'::jsonb,
  updated_at     bigint not null,
  server_updated bigint not null default public.ss_now_ms()
);
drop trigger if exists user_meta_touch on public.user_meta;
create trigger user_meta_touch before insert or update on public.user_meta
  for each row execute function public.ss_touch();

-- Segurança: cada usuário só enxerga e altera os próprios dados
alter table public.sermons   enable row level security;
alter table public.user_meta enable row level security;

drop policy if exists "sermons_own" on public.sermons;
create policy "sermons_own" on public.sermons
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "meta_own" on public.user_meta;
create policy "meta_own" on public.user_meta
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Imagens das ministrações (arquivos privados, uma pasta por usuário)
insert into storage.buckets (id, name, public)
values ('images', 'images', false)
on conflict (id) do nothing;

drop policy if exists "images_own_select" on storage.objects;
create policy "images_own_select" on storage.objects for select to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "images_own_insert" on storage.objects;
create policy "images_own_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "images_own_update" on storage.objects;
create policy "images_own_update" on storage.objects for update to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "images_own_delete" on storage.objects;
create policy "images_own_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Links de leitura (compartilhar uma ministração só para ler)
-- ============================================================
create table if not exists public.shares (
  id          text primary key,                 -- código aleatório do link
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sermon_id   text not null,
  data        jsonb not null,                   -- cópia do conteúdo no momento da publicação
  allow_copy  boolean not null default false,
  revoked     boolean not null default false,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.shares enable row level security;
drop policy if exists "shares_own" on public.shares;
create policy "shares_own" on public.shares
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Leitura pública só por quem tem o código (não permite listar os links)
create or replace function public.get_share(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('data', data, 'allow_copy', allow_copy, 'updated_at', updated_at)
  from public.shares
  where id = p_id and not revoked and (expires_at is null or expires_at > now())
$$;
revoke all on function public.get_share(text) from public;
grant execute on function public.get_share(text) to anon, authenticated;
