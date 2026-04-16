-- Extended job statuses, error_message, inputs/* storage paths, two-arg consume_one_credit.

-- ---------------------------------------------------------------------------
-- consume_one_credit(uuid, int) -> consume_credits (clip flow keeps 1-arg version)
-- ---------------------------------------------------------------------------
drop function if exists public.consume_one_credit (uuid, integer);

create function public.consume_one_credit (
  p_user_id uuid,
  p_cost integer
)
returns table (
  success boolean,
  reason text,
  remaining integer
)
language sql
security definer
set search_path = public
as $$
  select
    *
  from
    public.consume_credits (p_user_id, greatest(coalesce(p_cost, 1), 1));
$$;

revoke all on function public.consume_one_credit (uuid, integer) from public;

grant execute on function public.consume_one_credit (uuid, integer) to authenticated;

grant execute on function public.consume_one_credit (uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- video_jobs: error_message + expanded status values
-- ---------------------------------------------------------------------------
alter table public.video_jobs
add column if not exists error_message text;

alter table public.video_jobs
drop constraint if exists video_jobs_status_chk;

alter table public.video_jobs
add constraint video_jobs_status_chk check (
  status in (
    'queued',
    'processing',
    'transcribing',
    'planning',
    'generating',
    'analyzing',
    'complete',
    'failed'
  )
);

-- ---------------------------------------------------------------------------
-- Storage: allow objects at inputs/{user_id}/... in bucket videos
-- ---------------------------------------------------------------------------
drop policy if exists "videos_insert_own_folder" on storage.objects;

drop policy if exists "videos_select_own_folder" on storage.objects;

drop policy if exists "videos_update_own_folder" on storage.objects;

drop policy if exists "videos_delete_own_folder" on storage.objects;

create policy "videos_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'videos'
    and (
      split_part(name, '/', 1) = auth.uid ()::text
      or (
        split_part(name, '/', 1) = 'inputs'
        and split_part(name, '/', 2) = auth.uid ()::text
      )
    )
  );

create policy "videos_select_own_folder"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'videos'
    and (
      split_part(name, '/', 1) = auth.uid ()::text
      or (
        split_part(name, '/', 1) = 'inputs'
        and split_part(name, '/', 2) = auth.uid ()::text
      )
    )
  );

create policy "videos_update_own_folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'videos'
    and (
      split_part(name, '/', 1) = auth.uid ()::text
      or (
        split_part(name, '/', 1) = 'inputs'
        and split_part(name, '/', 2) = auth.uid ()::text
      )
    )
  );

create policy "videos_delete_own_folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'videos'
    and (
      split_part(name, '/', 1) = auth.uid ()::text
      or (
        split_part(name, '/', 1) = 'inputs'
        and split_part(name, '/', 2) = auth.uid ()::text
      )
    )
  );
