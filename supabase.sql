create extension if not exists pgcrypto;

create table if not exists public.forecasts (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('numbers3','numbers4')),
  target_round integer not null,
  target_date date,
  model text not null,
  model_version text not null default 'LEGACY',
  picks jsonb not null,
  scores jsonb,
  status text not null default 'pending' check (status in ('pending','settled')),
  winning_number text,
  straight_hit boolean default false,
  box_hit boolean default false,
  best_digit_match integer default 0,
  purchase_type text default 'straight',
  stake_yen integer default 2000,
  return_yen integer default 0,
  roi_percent numeric default 0,
  created_at timestamptz default now(),
  settled_at timestamptz
);

alter table public.forecasts add column if not exists model_version text not null default 'LEGACY';
alter table public.forecasts drop constraint if exists forecasts_model_check;
alter table public.forecasts add constraint forecasts_model_check check (model in ('hybrid','ai','statistical','random')) not valid;
alter table public.forecasts validate constraint forecasts_model_check;
alter table public.forecasts drop constraint if exists forecasts_game_target_round_model_key;
drop index if exists public.forecasts_unique;
create unique index if not exists forecasts_unique_versioned on public.forecasts(game,target_round,model,model_version);
create index if not exists forecasts_game_round_idx on public.forecasts(game,target_round desc);
create index if not exists forecasts_status_idx on public.forecasts(status);
alter table public.forecasts enable row level security;

create table if not exists public.oracle_cache (
  game text primary key check (game in ('numbers3','numbers4')),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.oracle_cache enable row level security;
