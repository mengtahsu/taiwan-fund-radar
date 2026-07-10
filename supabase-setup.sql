create extension if not exists pgcrypto;

create table if not exists public.fund_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fund_id text not null,
  fund_name text not null,
  buy_date date not null,
  amount numeric not null check (amount > 0),
  nav numeric check (nav is null or nav >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
