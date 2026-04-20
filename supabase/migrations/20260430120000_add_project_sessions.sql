-- Project history: display title, sort by activity, secure updates.

alter table public.generations
  add column if not exists title text,
  add column if not exists updated_at timestamptz;

update public.generations
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.generations
  alter column updated_at set default now();

alter table public.generations
  alter column updated_at set not null;

create or replace function public.generations_set_updated_at_trigger_fn ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists generations_updated_at on public.generations;

create trigger generations_updated_at
  before update on public.generations
  for each row
  execute procedure public.generations_set_updated_at_trigger_fn ();

create index if not exists generations_user_updated_idx
  on public.generations (user_id, updated_at desc);

create policy "generations_update_own"
  on public.generations
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- When a linked text-to-video job completes, bump parent generation for sidebar ordering.
create or replace function public.bump_generation_on_text_video_job_complete ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'complete'
     and (old.status is distinct from new.status)
     and new.generation_id is not null
     and length(trim(new.generation_id)) > 0 then
    update public.generations g
    set updated_at = now()
    where g.id::text = trim(new.generation_id);
  end if;
  return new;
end;
$$;

drop trigger if exists text_video_jobs_bump_generation_on_complete on public.text_video_jobs;

create trigger text_video_jobs_bump_generation_on_complete
  after update on public.text_video_jobs
  for each row
  execute procedure public.bump_generation_on_text_video_job_complete ();
