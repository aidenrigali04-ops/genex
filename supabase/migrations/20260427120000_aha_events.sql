create table if not exists public.aha_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event text not null,
  metadata jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists aha_events_user_id_event_idx on public.aha_events (user_id, event);
create index if not exists aha_events_occurred_at_idx on public.aha_events (occurred_at desc);

alter table public.aha_events enable row level security;

create policy "Users can insert own aha_events"
  on public.aha_events for insert
  with check (auth.uid() = user_id);

create policy "Users can read own aha_events"
  on public.aha_events for select
  using (auth.uid() = user_id);
