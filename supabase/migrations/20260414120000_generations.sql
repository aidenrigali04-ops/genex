-- Run in Supabase SQL editor or via Supabase CLI migrations.
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  input_text text,
  input_url text,
  platforms text[] not null,
  output text not null,
  created_at timestamptz not null default now()
);

create index if not exists generations_user_id_created_at_idx
  on public.generations (user_id, created_at desc);

alter table public.generations enable row level security;

create policy "generations_select_own"
  on public.generations
  for select
  using (auth.uid() = user_id);

create policy "generations_insert_own"
  on public.generations
  for insert
  with check (auth.uid() = user_id);
