-- Adds generation type metadata for clip packages vs generic runs.
alter table public.generations
  add column if not exists type text not null default 'generic';

create index if not exists generations_user_type_created_idx
  on public.generations (user_id, type, created_at desc);
