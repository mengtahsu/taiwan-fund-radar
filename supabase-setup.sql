create extension if not exists pgcrypto;

create table if not exists public.fund_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fund_id text not null,
  fund_name text not null,
  buy_date date not null,
  amount numeric not null check (amount > 0),
  nav numeric check (nav is null or nav >= 0),
  sell_date date,
  sell_nav numeric check (sell_nav is null or sell_nav >= 0),
  sell_amount numeric check (sell_amount is null or sell_amount >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fund_purchases
  add column if not exists sell_date date,
  add column if not exists sell_nav numeric check (sell_nav is null or sell_nav >= 0),
  add column if not exists sell_amount numeric check (sell_amount is null or sell_amount >= 0);

create index if not exists fund_purchases_user_date_idx
  on public.fund_purchases (user_id, buy_date desc, created_at desc);

alter table public.fund_purchases enable row level security;

drop policy if exists "Users can read own fund purchases" on public.fund_purchases;
create policy "Users can read own fund purchases"
  on public.fund_purchases
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own fund purchases" on public.fund_purchases;
create policy "Users can insert own fund purchases"
  on public.fund_purchases
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own fund purchases" on public.fund_purchases;
create policy "Users can update own fund purchases"
  on public.fund_purchases
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own fund purchases" on public.fund_purchases;
create policy "Users can delete own fund purchases"
  on public.fund_purchases
  for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.fund_nav_requests (
  fund_id text primary key,
  fund_name text,
  requested_at timestamptz not null default now()
);

alter table public.fund_nav_requests enable row level security;

drop policy if exists "Anyone can read fund nav requests" on public.fund_nav_requests;
create policy "Anyone can read fund nav requests"
  on public.fund_nav_requests
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone can insert fund nav requests" on public.fund_nav_requests;
create policy "Anyone can insert fund nav requests"
  on public.fund_nav_requests
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Anyone can update fund nav requests" on public.fund_nav_requests;
create policy "Anyone can update fund nav requests"
  on public.fund_nav_requests
  for update
  to anon, authenticated
  using (true)
  with check (true);

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
