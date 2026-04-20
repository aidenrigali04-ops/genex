-- Link clip embeddings to generations + expose metadata from similarity RPC.
-- generation_id is text (not FK): some deployments use uuid for generations.id,
-- others bigint; the app always passes the id as a string. No FK avoids 42804.

alter table public.clip_embedding_memory
  add column if not exists generation_id text;

comment on column public.clip_embedding_memory.generation_id is
  'String form of generations.id when known (uuid or bigint); optional, no FK for schema portability.';

alter table public.clip_embedding_memory
  add column if not exists metadata jsonb;

create index if not exists clip_embedding_memory_generation_idx
  on public.clip_embedding_memory (generation_id)
  where generation_id is not null;

drop function if exists public.match_clip_embeddings (vector, int, uuid);

create or replace function public.match_clip_embeddings (
  query_embedding vector(1536),
  match_count int,
  filter_user_id uuid
)
returns table (
  id uuid,
  content text,
  distance float,
  metadata jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.content,
    (m.embedding <=> query_embedding)::float as distance,
    m.metadata
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
  'Semantic recall of prior clip content for the same user (cosine distance); includes optional metadata.';

revoke all on function public.match_clip_embeddings (vector, int, uuid) from public;
grant execute on function public.match_clip_embeddings (vector, int, uuid) to authenticated;
grant execute on function public.match_clip_embeddings (vector, int, uuid) to service_role;

notify pgrst, 'reload schema';
