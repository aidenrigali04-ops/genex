-- Billing: plan tiers, Stripe mirrors, plan + bonus credits; consume uses plan first then bonus.
-- Idempotent Stripe webhook log.
-- Leading no-op: avoids rare clients that truncate the first character of a statement (`create` -> `reate`).
select 1
where
  false;

create table if not exists public.stripe_webhook_events (
  id text primary key,
  received_at timestamptz not null default now()
);

comment on table public.stripe_webhook_events is 'Stripe event ids processed (idempotency).';

alter table public.stripe_webhook_events disable row level security;

alter table public.profiles
  add column if not exists username text,
  add column if not exists plan_tier text not null default 'none',
  add column if not exists subscription_status text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists current_period_end timestamptz,
  add column if not exists plan_credits_remaining integer not null default 0,
  add column if not exists bonus_credits integer not null default 0,
  add column if not exists monthly_credit_allowance integer not null default 0;

comment on column public.profiles.plan_tier is 'none | basic | creator | team';
comment on column public.profiles.subscription_status is 'Mirror Stripe subscription.status when subscribed.';
comment on column public.profiles.plan_credits_remaining is 'Monthly pool remaining (spent before bonus_credits).';
comment on column public.profiles.bonus_credits is 'Top-up credits; spent after plan_credits_remaining reaches 0.';

alter table public.profiles
  alter column credits set default 0;

-- New auth users: zero balance until Stripe checkout completes.
create or replace function public.handle_new_user_profiles ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    daily_generations,
    last_reset_at,
    credits,
    plan_tier,
    subscription_status,
    plan_credits_remaining,
    bonus_credits,
    monthly_credit_allowance,
    updated_at
  )
  values (
    new.id,
    0,
    now (),
    0,
    'none',
    null,
    0,
    0,
    0,
    now ()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Grandfather existing non-unlimited accounts so they keep access until Stripe is configured.
update public.profiles p
set
  subscription_status = 'active',
  plan_tier = 'basic',
  monthly_credit_allowance = 100,
  plan_credits_remaining = least(
    100,
    greatest(coalesce(p.credits, 0), 0)
  ),
  bonus_credits = 0,
  current_period_end = timezone('utc', now()) + interval '365 days',
  credits = least(100, greatest(coalesce(p.credits, 0), 0))
where
  coalesce(p.unlimited_credits, false) = false
  and p.stripe_subscription_id is null
  and p.stripe_customer_id is null
  and (
    p.subscription_status is null
    or p.subscription_status not in ('trialing', 'active')
  );

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
  r public.profiles%rowtype;
  cost int := greatest(coalesce(p_cost, 0), 0);
  new_plan int;
  new_bonus int;
  total_rem int;
  entitled boolean;
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

  insert into public.profiles (
    id,
    credits,
    last_reset_at,
    plan_tier,
    subscription_status,
    plan_credits_remaining,
    bonus_credits,
    monthly_credit_allowance,
    updated_at
  )
  values (
    p_user_id,
    0,
    now (),
    'none',
    null,
    0,
    0,
    0,
    now ()
  )
  on conflict (id) do update
  set
    updated_at = public.profiles.updated_at
  returning
    * into strict r;

  select
    * into strict r
  from
    public.profiles
  where
    id = p_user_id;

  if coalesce(r.unlimited_credits, false) then
    total_rem := greatest(0, coalesce(r.plan_credits_remaining, 0) + coalesce(r.bonus_credits, 0));
    return query
    select
      true,
      null::text,
      total_rem;
    return;
  end if;

  entitled :=
    r.subscription_status is not null
    and r.subscription_status in ('trialing', 'active');

  if not entitled then
    return query
    select
      false,
      'no_credits'::text,
      0;
    return;
  end if;

  new_plan := greatest(0, coalesce(r.plan_credits_remaining, 0));
  new_bonus := greatest(0, coalesce(r.bonus_credits, 0));

  if new_plan >= cost then
    new_plan := new_plan - cost;
  else
    new_bonus := new_bonus - (cost - new_plan);
    new_plan := 0;
  end if;

  if new_bonus < 0 then
    return query
    select
      false,
      'no_credits'::text,
      0;
    return;
  end if;

  total_rem := new_plan + new_bonus;

  update public.profiles
  set
    plan_credits_remaining = new_plan,
    bonus_credits = new_bonus,
    credits = total_rem,
    updated_at = now ()
  where
    id = p_user_id;

  return query
  select
    true,
    null::text,
    total_rem;
end;
$$;

revoke all on function public.consume_credits (integer, uuid) from public;

grant execute on function public.consume_credits (integer, uuid) to authenticated;

grant execute on function public.consume_credits (integer, uuid) to service_role;

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

-- Refund one credit to the monthly pool (clip/chat failure path).
-- Single UPDATE only: RHS uses OLD row values (no PL/pgSQL vars in SET, avoids name/relation bugs).
create or replace function public.refund_one_credit (p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid () is null or auth.uid () <> p_user_id then
    return;
  end if;

  update public.profiles
  set
    plan_credits_remaining = coalesce(plan_credits_remaining, 0) + 1,
    credits = (coalesce(plan_credits_remaining, 0) + 1) + coalesce(bonus_credits, 0),
    updated_at = now ()
  where
    id = p_user_id;
end;
$$;

revoke all on function public.refund_one_credit (uuid) from public;

grant execute on function public.refund_one_credit (uuid) to authenticated;

grant execute on function public.refund_one_credit (uuid) to service_role;
