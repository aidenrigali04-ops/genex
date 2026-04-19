/* Text-video: atomic claim RPC (same pattern as worker_claim_next_video_job).
   Single-statement SQL body avoids SELECT INTO / variable parsing issues in the SQL editor. */

create or replace function public.worker_claim_next_text_video_job ()
returns setof public.text_video_jobs
language sql
security definer
set search_path = public
as $$
  with picked as (
    select
      id
    from
      public.text_video_jobs
    where
      status = 'queued'
    order by
      created_at asc
    limit
      1
    for update
      skip locked
  )
  update public.text_video_jobs as t
  set
    status = 'planning',
    updated_at = now ()
  from
    picked as p
  where
    t.id = p.id
    and t.status = 'queued'
  returning
    t.*;
$$;

comment on function public.worker_claim_next_text_video_job () is 'Atomically pick oldest queued text_video_job and set status to planning; for service_role only.';

revoke all on function public.worker_claim_next_text_video_job () from public;

revoke all on function public.worker_claim_next_text_video_job () from authenticated;

grant execute on function public.worker_claim_next_text_video_job () to service_role;

notify pgrst, 'reload schema';
