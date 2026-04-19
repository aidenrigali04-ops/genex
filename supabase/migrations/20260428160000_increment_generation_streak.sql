-- Streak + generation_count RPC (runs after 20260428120000 generation_count and 20260428140000 streak column).
-- Filename uses 20260428160000 so columns exist on fresh resets.
--
-- Implemented as LANGUAGE sql + data-modifying CTEs (no PL/pgSQL, no %ROWTYPE, no SELECT INTO vars)
-- so SQL runners that split on `;` or mishandle `$fn$` bodies cannot mis-parse variable names as relations.

alter table public.profiles
  add column if not exists longest_streak integer not null default 0,
  add column if not exists last_generation_date date;

comment on column public.profiles.longest_streak is 'Best consecutive-day generation streak.';
comment on column public.profiles.last_generation_date is 'UTC date (server) of last counted generation for streak logic.';

-- Atomically increments generation_count and updates streak.
-- Called from app/api/chat/route.ts and app/api/generate/route.ts after a successful credit deduction.

create or replace function public.increment_generation_streak(
  p_user_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
as $fn$
with locked as (
  select *
  from public.profiles
  where id = p_user_id
  for update
),
calc as (
  select
    l.id,
    (timezone('utc', now()))::date as today,
    l.generation_count,
    (l.generation_count = 0) as is_first_gen,
    l.generation_count + 1 as new_gen_count,
    case
      when l.last_generation_date is null then 1
      when l.last_generation_date = (timezone('utc', now()))::date then greatest(l.current_streak, 1)
      when l.last_generation_date = (timezone('utc', now()))::date - 1 then l.current_streak + 1
      else 1
    end as new_streak,
    l.longest_streak
  from locked l
),
calc2 as (
  select
    c.*,
    greatest(c.longest_streak, c.new_streak) as new_longest
  from calc c
),
upd as (
  update public.profiles p
  set
    generation_count = c2.new_gen_count,
    current_streak = c2.new_streak,
    longest_streak = c2.new_longest,
    last_generation_date = c2.today
  from calc2 c2
  where p.id = c2.id
  returning jsonb_build_object(
    'generation_count', c2.new_gen_count,
    'current_streak', c2.new_streak,
    'longest_streak', c2.new_longest,
    'is_first_gen', c2.is_first_gen
  ) as result
)
select coalesce(
  (select u.result from upd u limit 1),
  jsonb_build_object('error', 'profile_not_found')
);
$fn$;

grant execute on function public.increment_generation_streak(uuid)
  to authenticated;

grant execute on function public.increment_generation_streak(uuid)
  to service_role;
