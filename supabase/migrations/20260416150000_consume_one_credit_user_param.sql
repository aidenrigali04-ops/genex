-- Replace consume_one_credit(): explicit user id + structured result for PostgREST.

drop function if exists public.consume_one_credit ();

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

  insert into public.profiles (id, credits, last_reset_at)
  values (p_user_id, bucket, now ())
  on conflict (id) do nothing;

  select
    * into r
  from
    public.profiles
  where
    id = p_user_id
  for update;

  if not found then
    return query
    select
      false,
      'no_profile'::text,
      0;
    return;
  end if;

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
      * into r
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

revoke all on function public.consume_one_credit (uuid) from public;

grant execute on function public.consume_one_credit (uuid) to authenticated;

grant execute on function public.consume_one_credit (uuid) to service_role;
