-- Free daily credits (decrement per generation) + public waitlist inserts.

alter table public.profiles
  add column if not exists credits integer not null default 3;

comment on column public.profiles.credits is 'Remaining free generations today; resets to 3 when last_reset_at is before current UTC date.';

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid (),
  email text not null,
  created_at timestamptz not null default now (),
  constraint waitlist_email_unique unique (email)
);

create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);

alter table public.waitlist enable row level security;

create policy "waitlist_allow_insert"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (true);

-- One credit per generation for signed-in users (auth.uid()). Resets credits to 3 on new UTC day before check.
create or replace function public.consume_one_credit ()
returns table (
  allowed boolean,
  remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid ();
  today_utc date := (timezone ('utc', now ()))::date;
  last_utc date;
  r public.profiles%rowtype;
  bucket int := 3;
begin
  if uid is null then
    return query
    select
      false,
      0;
    return;
  end if;

  insert into public.profiles (id, credits, last_reset_at)
  values (uid, bucket, now ())
  on conflict (id) do nothing;

  select
    * into r
  from
    public.profiles
  where
    id = uid
  for update;

  last_utc := (timezone ('utc', r.last_reset_at))::date;

  if last_utc < today_utc then
    update public.profiles
    set
      credits = bucket,
      last_reset_at = now (),
      updated_at = now ()
    where
      id = uid;

    select
      * into r
    from
      public.profiles
    where
      id = uid;
  end if;

  if r.credits <= 0 then
    return query
    select
      false,
      0;
    return;
  end if;

  update public.profiles
  set
    credits = credits - 1,
    updated_at = now ()
  where
    id = uid
  returning
    credits into r.credits;

  return query
  select
    true,
    r.credits;
end;
$$;

revoke all on function public.consume_one_credit () from public;

grant execute on function public.consume_one_credit () to authenticated;

grant execute on function public.consume_one_credit () to service_role;
