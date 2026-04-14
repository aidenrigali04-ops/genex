-- Daily free generation limit (per user, UTC calendar day).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  daily_generations integer not null default 0,
  last_reset_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_id_idx on public.profiles (id);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

comment on table public.profiles is 'App profile; daily_generations resets when last_reset_at is before current UTC date.';

-- New auth users get a row (optional; RPC also upserts on first generation).
create or replace function public.handle_new_user_profiles ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, daily_generations, last_reset_at)
  values (new.id, 0, now())
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profiles on auth.users;

create trigger on_auth_user_created_profiles
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user_profiles ();

-- Atomically reset day if needed, enforce limit, increment when allowed.
create or replace function public.consume_one_daily_generation ()
returns table (
  allowed boolean,
  used_count integer,
  max_free integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid ();
  v_max integer := 5;
  r public.profiles%rowtype;
  today_utc date := (timezone ('utc', now ()))::date;
  last_utc date;
  new_count integer;
begin
  if uid is null then
    return query
    select
      false,
      0,
      v_max;
    return;
  end if;

  insert into public.profiles (id, daily_generations, last_reset_at)
  values (uid, 0, now ())
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
      daily_generations = 0,
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

  if r.daily_generations >= v_max then
    return query
    select
      false,
      r.daily_generations,
      v_max;
    return;
  end if;

  update public.profiles
  set
    daily_generations = daily_generations + 1,
    updated_at = now ()
  where
    id = uid
  returning
    daily_generations into new_count;

  return query
  select
    true,
    new_count,
    v_max;
end;
$$;

revoke all on function public.consume_one_daily_generation () from public;

grant execute on function public.consume_one_daily_generation () to authenticated;

grant execute on function public.consume_one_daily_generation () to service_role;
