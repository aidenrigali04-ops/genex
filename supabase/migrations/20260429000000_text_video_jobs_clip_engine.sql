-- Structured conversation-engine payload for text→video jobs (intent + planner context).
alter table public.text_video_jobs
  add column if not exists clip_engine jsonb;

comment on column public.text_video_jobs.clip_engine is
  'Clip conversation engine bundle: intent, rolling summary, planner_context_block, evaluation (server-only).';
