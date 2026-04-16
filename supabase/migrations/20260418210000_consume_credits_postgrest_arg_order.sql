-- PostgREST matches RPC by argument types in alphabetical parameter-name order:
-- p_cost (integer) then p_user_id (uuid). The previous signature (uuid, integer) does not match.

drop function if exists public.consume_one_credit (uuid, integer);

drop function if exists public.consume_credits (uuid, integer);

create or replace function public.consume_credits (
  p_cost integer,
  p_user_id uuid
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
  cost int := greatest(coalesce(p_cost, 0), 0);
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

revoke all on function public.consume_credits (integer, uuid) from public;

grant execute on function public.consume_credits (integer, uuid) to authenticated;

grant execute on function public.consume_credits (integer, uuid) to service_role;

-- Back-compat: single credit for clip flow (PostgREST: only p_user_id → still uuid-only overload).
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
    public.consume_credits (1, p_user_id);
$$;

revoke all on function public.consume_one_credit (uuid) from public;

grant execute on function public.consume_one_credit (uuid) to authenticated;

grant execute on function public.consume_one_credit (uuid) to service_role;

-- Optional two-arg alias (integer, uuid) for PostgREST clients.
create or replace function public.consume_one_credit (
  p_cost integer,
  p_user_id uuid
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
    public.consume_credits (greatest(coalesce(p_cost, 1), 1), p_user_id);
$$;

revoke all on function public.consume_one_credit (integer, uuid) from public;

grant execute on function public.consume_one_credit (integer, uuid) to authenticated;

grant execute on function public.consume_one_credit (integer, uuid) to service_role;
