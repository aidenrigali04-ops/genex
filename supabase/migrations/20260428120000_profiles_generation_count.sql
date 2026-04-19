-- Tracks completed clip/chat generations for product analytics (e.g. second_generation aha).
alter table public.profiles
  add column if not exists generation_count integer not null default 0;

comment on column public.profiles.generation_count is 'Number of completed generations; incremented after successful /api/chat streams for signed-in users.';
