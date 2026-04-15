-- Fix "no_profile" from consume_one_credit: allow users to insert/update own profile,
-- and upsert profile in one statement so a row always exists before credit logic.

drop policy if exists "profiles_insert_own" on public.profiles;

create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid () = id);

drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid () = id)
  with check (auth.uid () = id);

create or replace function public.consume_one_credit (p_user_id uuid)
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
begin
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

  if r.credits <= 0 then
    return query
    select
      false,
      'no_credits'::text,
      0;
    return;
  end if;

  update public.profiles
  set
    credits = credits - 1,
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
