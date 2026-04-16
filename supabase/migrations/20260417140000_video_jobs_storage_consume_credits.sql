-- Video-first jobs + storage bucket + multi-cost credits.

-- ---------------------------------------------------------------------------
-- consume_credits: same daily reset as single-credit flow, deduct p_cost.
-- ---------------------------------------------------------------------------
create or replace function public.consume_credits (
  p_user_id uuid,
  p_cost integer
)
returns table (
  success boolean,
  reason text,
  remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  today_utc date := (timezone ('utc', now ()))::date;
  last_utc date;
  r public.profiles%rowtype;
  bucket int := 3;
  cost int := coalesce(p_cost, 0);
begin
  if cost < 1 then
    return query
    select
      false,
      'invalid_cost'::text,
      0;
    return;
  end if;

  if auth.uid () is null then
    return query
    select
      false,
      'not_authenticated'::text,
      0;
    return;
  end if;

  if auth.uid () <> p_user_id then
    return query
    select
      false,
      'forbidden'::text,
      0;
    return;
  end if;

  insert into public.profiles (id, credits, last_reset_at, updated_at)
  values (p_user_id, bucket, now (), now ())
  on conflict (id) do update
  set
    credits = public.profiles.credits,
    updated_at = public.profiles.updated_at
  returning
    * into strict r;

  if r.last_reset_at is null then
    last_utc := 'epoch'::date;
  else
    last_utc := (timezone ('utc', r.last_reset_at))::date;
  end if;

  if last_utc < today_utc then
    update public.profiles
    set
      credits = bucket,
      last_reset_at = now (),
      updated_at = now ()
    where
      id = p_user_id;

    select
      * into strict r
    from
      public.profiles
    where
      id = p_user_id;
  end if;

  if r.credits < cost then
    return query
    select
      false,
      'no_credits'::text,
      0;
    return;
  end if;

  update public.profiles
  set
    credits = credits - cost,
    updated_at = now ()
  where
    id = p_user_id
  returning
    credits into r.credits;

  return query
  select
    true,
    null::text,
    r.credits;
end;
$$;

revoke all on function public.consume_credits (uuid, integer) from public;

grant execute on function public.consume_credits (uuid, integer) to authenticated;

grant execute on function public.consume_credits (uuid, integer) to service_role;

-- Back-compat: clip generations still call consume_one_credit(uuid).
create or replace function public.consume_one_credit (p_user_id uuid)
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
    public.consume_credits (p_user_id, 1);
$$;

revoke all on function public.consume_one_credit (uuid) from public;

-- ---------------------------------------------------------------------------
-- video_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  input_type text not null,
  input_url text,
  storage_path text,
  prompt text not null,
  status text not null default 'queued',
  variations jsonb default '[]'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint video_jobs_input_type_chk check (input_type in ('upload', 'url')),
  constraint video_jobs_status_chk check (
    status in (
      'queued',
      'analyzing',
      'generating',
      'complete',
      'failed'
    )
  )
);

create index if not exists video_jobs_user_created_idx on public.video_jobs (user_id, created_at desc);

comment on table public.video_jobs is 'Video-first AI editor jobs; status drives client polling UI.';

alter table public.video_jobs enable row level security;

create policy "video_jobs_select_own"
  on public.video_jobs
  for select
  to authenticated
  using (auth.uid () = user_id);

create policy "video_jobs_insert_own"
  on public.video_jobs
  for insert
  to authenticated
  with check (auth.uid () = user_id);

create policy "video_jobs_update_own"
  on public.video_jobs
  for update
  to authenticated
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

-- ---------------------------------------------------------------------------
-- Storage: private bucket "videos" (500MB class uploads)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 524288000)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit;

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
    and split_part(name, '/', 1) = auth.uid ()::text
  );

create policy "videos_select_own_folder"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'videos'
    and split_part(name, '/', 1) = auth.uid ()::text
  );

create policy "videos_update_own_folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'videos'
    and split_part(name, '/', 1) = auth.uid ()::text
  );

create policy "videos_delete_own_folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'videos'
    and split_part(name, '/', 1) = auth.uid ()::text
  );

grant execute on function public.consume_one_credit (uuid) to authenticated;

grant execute on function public.consume_one_credit (uuid) to service_role;
