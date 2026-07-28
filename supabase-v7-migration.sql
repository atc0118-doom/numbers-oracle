-- NUMBERS ORACLE V7: existing V6.5 database migration
alter table public.forecasts add column if not exists model_version text not null default 'LEGACY';
alter table public.forecasts drop constraint if exists forecasts_model_check;
alter table public.forecasts add constraint forecasts_model_check check (model in ('hybrid','ai','statistical','random')) not valid;
alter table public.forecasts validate constraint forecasts_model_check;
alter table public.forecasts drop constraint if exists forecasts_game_target_round_model_key;
drop index if exists public.forecasts_unique;
create unique index if not exists forecasts_unique_versioned on public.forecasts(game,target_round,model,model_version);
