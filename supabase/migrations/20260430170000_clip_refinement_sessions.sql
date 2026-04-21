-- Persist clip refinement chat (each successful /api/refinement-conversation turn upserts this row).

create table if not exists public.clip_refinement_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  refinement_kind text not null,
  input_summary text,
  messages jsonb not null default '[]'::jsonb,
  answers_partial jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists clip_refinement_sessions_user_updated_idx
  on public.clip_refinement_sessions (user_id, updated_at desc);

comment on table public.clip_refinement_sessions is
  'Clip refinement transcript: messages sent to the refinement-conversation model; upserted after each successful turn.';

create or replace function public.clip_refinement_sessions_set_updated_at_trigger_fn ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clip_refinement_sessions_updated_at on public.clip_refinement_sessions;

create trigger clip_refinement_sessions_updated_at
  before update on public.clip_refinement_sessions
  for each row
  execute procedure public.clip_refinement_sessions_set_updated_at_trigger_fn ();

alter table public.clip_refinement_sessions enable row level security;

create policy "clip_refinement_sessions_select_own"
  on public.clip_refinement_sessions
  for select
  using (auth.uid() = user_id);

create policy "clip_refinement_sessions_insert_own"
  on public.clip_refinement_sessions
  for insert
  with check (auth.uid() = user_id);

create policy "clip_refinement_sessions_update_own"
  on public.clip_refinement_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
