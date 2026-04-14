-- Align an existing `generations` table with what the app expects.
-- Safe to run if some columns already exist (IF NOT EXISTS).

alter table public.generations add column if not exists input_text text;
alter table public.generations add column if not exists input_url text;
alter table public.generations add column if not exists platforms text[];
alter table public.generations add column if not exists output text;
alter table public.generations add column if not exists created_at timestamptz default now();
alter table public.generations add column if not exists type text not null default 'generic';

-- Helpful backfills when columns were just added (no-op if already set)
update public.generations set platforms = '{}'::text[] where platforms is null;
update public.generations set output = '' where output is null;

create index if not exists generations_user_type_created_idx
  on public.generations (user_id, type, created_at desc);
