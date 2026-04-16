-- Idempotent repair: ensure claim RPC matches latest behavior (upload jobs only
-- after storage_path is set) and PostgREST picks up the function.

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

comment on function public.worker_claim_next_video_job () is 'Atomically pick oldest claimable queued video_job (URL always; upload only when storage_path set); for service_role only.';

revoke all on function public.worker_claim_next_video_job () from public;

revoke all on function public.worker_claim_next_video_job () from authenticated;

grant execute on function public.worker_claim_next_video_job () to service_role;

notify pgrst, 'reload schema';
