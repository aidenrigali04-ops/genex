create or replace function public.worker_requeue_stale_jobs()
returns void
language sql
security definer
as $$
  update public.video_jobs
  set 
    status = 'queued',
    updated_at = now()
  where 
    status = 'processing'
    and updated_at < now() - interval '15 minutes';
$$;

revoke execute on function public.worker_requeue_stale_jobs() from public;
grant execute on function public.worker_requeue_stale_jobs() to service_role;
