-- Per-user unlimited generations (UI + consume_credits skip). Used for ops / VIP accounts.

-- Older or template `profiles` tables may omit these; consume_credits expects them.
alter table public.profiles
  add column if not exists credits integer not null default 3,
  add column if not exists last_reset_at timestamptz not null default now (),
  add column if not exists updated_at timestamptz not null default now ();

alter table public.profiles
add column if not exists unlimited_credits boolean not null default false;

comment on column public.profiles.unlimited_credits is 'When true, consume_credits does not deduct; UI treats as unlimited.';

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

  if coalesce(r.unlimited_credits, false) then
    return query
    select
      true,
      null::text,
      r.credits;
    return;
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

insert into public.profiles (id, credits, last_reset_at, unlimited_credits, updated_at)
select
  u.id,
  3,
  now (),
  true,
  now ()
from
  auth.users u
where
  lower(u.email) = lower('aidenrigali04@gmail.com')
on conflict (id) do update
set
  unlimited_credits = true,
  updated_at = now ();
