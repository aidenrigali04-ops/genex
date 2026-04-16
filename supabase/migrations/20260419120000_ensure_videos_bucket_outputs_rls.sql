-- Fix "Bucket not found" when `videos` was never created (migrations skipped / new project).
-- Also allow objects under outputs/{user_id}/... for worker outputs and signed playback.

insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 524288000)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
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
    and (
      split_part(name, '/', 1) = auth.uid ()::text
      or (
        split_part(name, '/', 1) = 'inputs'
        and split_part(name, '/', 2) = auth.uid ()::text
      )
      or (
        split_part(name, '/', 1) = 'outputs'
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
      or (
        split_part(name, '/', 1) = 'outputs'
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
      or (
        split_part(name, '/', 1) = 'outputs'
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
      or (
        split_part(name, '/', 1) = 'outputs'
        and split_part(name, '/', 2) = auth.uid ()::text
      )
    )
  );
