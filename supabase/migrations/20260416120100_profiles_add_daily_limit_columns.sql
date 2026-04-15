-- If `public.profiles` already existed (e.g. Supabase template) without limit
-- columns, add them. Safe to run after 20260416120000_profiles_daily_generations.sql.

alter table public.profiles
  add column if not exists daily_generations integer not null default 0,
  add column if not exists last_reset_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
