-- Clip pipeline: vector memory (pgvector), vault journal, RPC for similarity search.

create extension if not exists vector;

create table if not exists public.clip_embedding_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.text_video_jobs (id) on delete set null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists clip_embedding_memory_user_created_idx
  on public.clip_embedding_memory (user_id, created_at desc);

-- Vector ANN index: add ivfflat/hnsw after you have representative rows (see Supabase pgvector docs).

create table if not exists public.clip_vault_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.text_video_jobs (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists clip_vault_entries_user_created_idx
  on public.clip_vault_entries (user_id, created_at desc);

alter table public.clip_embedding_memory enable row level security;
alter table public.clip_vault_entries enable row level security;

drop policy if exists "clip_embedding_memory_own" on public.clip_embedding_memory;
create policy "clip_embedding_memory_own"
  on public.clip_embedding_memory
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "clip_vault_entries_own" on public.clip_vault_entries;
create policy "clip_vault_entries_own"
  on public.clip_vault_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.match_clip_embeddings (
  query_embedding vector(1536),
  match_count int,
  filter_user_id uuid
)
returns table (
  id uuid,
  content text,
  distance float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.content,
    (m.embedding <=> query_embedding)::float as distance
  from
    public.clip_embedding_memory m
  where
    m.user_id = filter_user_id
  order by
    m.embedding <=> query_embedding
  limit
    least(greatest(coalesce(match_count, 5), 1), 20);
$$;

comment on function public.match_clip_embeddings is
  'Semantic recall of prior clip prompts for the same user (cosine distance).';

revoke all on function public.match_clip_embeddings (vector, int, uuid) from public;
grant execute on function public.match_clip_embeddings (vector, int, uuid) to authenticated;
grant execute on function public.match_clip_embeddings (vector, int, uuid) to service_role;

notify pgrst, 'reload schema';
