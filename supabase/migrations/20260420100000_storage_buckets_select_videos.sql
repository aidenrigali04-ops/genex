-- Upload/list flows read bucket metadata from storage.buckets. If RLS blocks SELECT,
-- the Storage API returns 404 "Bucket not found" even when the bucket row exists.
-- (Do not enable RLS here: platform may own storage.buckets; policies apply when RLS is on.)

drop policy if exists "videos_bucket_select_authenticated" on storage.buckets;

create policy "videos_bucket_select_authenticated"
  on storage.buckets
  for select
  to authenticated
  using (id = 'videos');
