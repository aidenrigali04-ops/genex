-- Allow user-cancelled jobs (PATCH from app) without violating status check.

alter table public.text_video_jobs
  drop constraint if exists text_video_jobs_status_check;

alter table public.text_video_jobs
  add constraint text_video_jobs_status_check check (
    status in (
      'queued',
      'planning',
      'fetching',
      'assembling',
      'uploading',
      'complete',
      'failed',
      'cancelled'
    )
  );
