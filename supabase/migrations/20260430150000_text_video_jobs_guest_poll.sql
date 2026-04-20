-- Anonymous stock-video jobs: poll status with a secret token (no Supabase session).

alter table public.text_video_jobs
  add column if not exists guest_poll_token text;

create unique index if not exists text_video_jobs_guest_poll_token_uidx
  on public.text_video_jobs (guest_poll_token)
  where guest_poll_token is not null;
