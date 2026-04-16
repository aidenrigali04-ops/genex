-- Repair: PostgREST error "Could not find the 'updated_at' column of 'video_jobs' in the schema cache"
-- when the table predates migrations or was created without this column.

alter table public.video_jobs
add column if not exists updated_at timestamptz;

update public.video_jobs
set
  updated_at = coalesce(updated_at, created_at, now());

alter table public.video_jobs
alter column updated_at set default now ();

alter table public.video_jobs
alter column updated_at set not null;

notify pgrst, 'reload schema';
