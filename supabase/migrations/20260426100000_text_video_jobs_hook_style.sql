-- Optional hook style label for shot planner (TikTok/Reels tone).
alter table public.text_video_jobs
  add column if not exists hook_style text;

comment on column public.text_video_jobs.hook_style is 'Short label passed to shot planner (e.g. viral, curiosity, contrarian).';
