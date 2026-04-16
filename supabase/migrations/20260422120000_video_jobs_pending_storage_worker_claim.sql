-- Direct client uploads: worker must not claim upload jobs until storage_path is set.

alter table public.video_jobs
add column if not exists pending_storage_path text;

comment on column public.video_jobs.pending_storage_path is 'Object key under bucket videos reserved for a signed upload before storage_path is set.';

-- Oldest eligible queued row: URL jobs (no storage_path) or upload jobs with file already in bucket.
create or replace function public.worker_claim_next_video_job ()
returns setof public.video_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  jid uuid;
begin
  select
    id into jid
  from
    public.video_jobs
  where
    status = 'queued'
    and (
      input_type <> 'upload'
      or storage_path is not null
    )
  order by
    created_at asc
  limit
    1
  for update
    skip locked;

  if jid is null then
    return;
  end if;

  return query
  update public.video_jobs
  set
    status = 'processing',
    updated_at = now ()
  where
    id = jid
    and status = 'queued'
  returning
    *;
end;
$$;

comment on function public.worker_claim_next_video_job () is 'Atomically pick oldest queued video_job and set status to processing; skips upload rows until storage_path is set.';
