-- Optional structured answers from pre-generation refinement chat.

alter table public.generations
add column if not exists generation_context jsonb;

comment on column public.generations.generation_context is 'Refinement chat answers and platform hints stored with each generation.';

alter table public.video_jobs
add column if not exists generation_context jsonb;

comment on column public.video_jobs.generation_context is 'Refinement chat answers for video variation jobs.';

notify pgrst, 'reload schema';
