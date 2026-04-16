-- Let the video worker claim jobs via RPC (SECURITY DEFINER) so claims work even when
-- PostgREST/GRANT edge cases would hide `queued` rows from the service client.

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

comment on function public.worker_claim_next_video_job () is 'Atomically pick oldest queued video_job and set status to processing; for worker service_role only.';

revoke all on function public.worker_claim_next_video_job () from public;

revoke all on function public.worker_claim_next_video_job () from authenticated;

grant execute on function public.worker_claim_next_video_job () to service_role;
