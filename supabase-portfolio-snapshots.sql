create table if not exists public.portfolio_period_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('month', 'week')),
  period_key text not null,
  period_date text,
  invested numeric not null default 0,
  value numeric not null default 0,
  profit numeric not null default 0,
  valued integer not null default 0,
  missing integer not null default 0,
  details jsonb not null default '[]'::jsonb,
  source_updated_at text,
  updated_at timestamptz not null default now(),
  primary key (user_id, period_type, period_key)
);

create index if not exists portfolio_period_snapshots_user_type_key_idx
  on public.portfolio_period_snapshots (user_id, period_type, period_key desc);

alter table public.portfolio_period_snapshots enable row level security;

drop policy if exists "Users can read own portfolio snapshots" on public.portfolio_period_snapshots;
create policy "Users can read own portfolio snapshots"
  on public.portfolio_period_snapshots
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own portfolio snapshots" on public.portfolio_period_snapshots;
create policy "Users can insert own portfolio snapshots"
  on public.portfolio_period_snapshots
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own portfolio snapshots" on public.portfolio_period_snapshots;
create policy "Users can update own portfolio snapshots"
  on public.portfolio_period_snapshots
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own portfolio snapshots" on public.portfolio_period_snapshots;
create policy "Users can delete own portfolio snapshots"
  on public.portfolio_period_snapshots
  for delete
  to authenticated
  using (auth.uid() = user_id);
