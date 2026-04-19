-- Stage 2: text → assembled MP4 (Pexels + ElevenLabs + ffmpeg), parallel to existing video_jobs.

create table if not exists public.text_video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Links to generations.id; type differs by project (uuid vs bigint). Store as text, no FK, so all deployments apply cleanly.
  generation_id text,
  script text not null,
  voice_id text not null default '21m00Tcm4TlvDq8ikWAM',
  status text not null default 'queued'
    check (
      status in (
        'queued',
        'planning',
        'fetching',
        'assembling',
        'uploading',
        'complete',
        'failed'
      )
    ),
  shot_plan jsonb,
  output_url text,
  storage_path text,
  error_message text,
  credit_cost int not null default 5,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists text_video_jobs_user_created_idx
  on public.text_video_jobs (user_id, created_at desc);

create index if not exists text_video_jobs_status_created_idx
  on public.text_video_jobs (status, created_at asc);

alter table public.text_video_jobs enable row level security;

create policy "Users manage own text video jobs"
  on public.text_video_jobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_text_video_job_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now ();
  return new;
end;
$$;

drop trigger if exists text_video_jobs_updated_at on public.text_video_jobs;

create trigger text_video_jobs_updated_at
  before update on public.text_video_jobs
  for each row
  execute procedure public.touch_text_video_job_updated_at ();

-- Private bucket for worker upload + signed playback URLs.
insert into storage.buckets (id, name, public)
values ('text-video-outputs', 'text-video-outputs', false)
on conflict (id) do nothing;
