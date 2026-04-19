-- Voice profile + streak for sidebar retention mechanics.
alter table public.profiles
  add column if not exists niche text,
  add column if not exists tone_preference text,
  add column if not exists hook_style text,
  add column if not exists current_streak integer not null default 0;

comment on column public.profiles.niche is 'Creator niche for personalized generations.';
comment on column public.profiles.tone_preference is 'Preferred tone of voice.';
comment on column public.profiles.hook_style is 'Preferred hook style (e.g. viral, curiosity).';
comment on column public.profiles.current_streak is 'Consecutive-day generation streak for UI.';
