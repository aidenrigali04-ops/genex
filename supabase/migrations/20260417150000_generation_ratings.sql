-- After public.video_jobs (20260417140000) for job_id FK.
create table if not exists public.generation_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.video_jobs (id) on delete set null,
  generation_id uuid null,
  rating text not null check (rating in ('up', 'down')),
  kind text not null check (kind in ('video', 'text')),
  created_at timestamptz default now()
);

alter table public.generation_ratings enable row level security;

create policy "Users manage own ratings" on public.generation_ratings
  for all using (auth.uid() = user_id);
