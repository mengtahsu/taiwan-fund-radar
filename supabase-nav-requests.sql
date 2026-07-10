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
