-- Repair environments that created text_video_jobs with uuid generation_id + broken FK,
-- or any column type that should be plain text for uuid/bigint generation ids.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'text_video_jobs'
  ) then
    alter table public.text_video_jobs
      drop constraint if exists text_video_jobs_generation_id_fkey;

    alter table public.text_video_jobs
      alter column generation_id type text using generation_id::text;
  end if;
end
$$;
