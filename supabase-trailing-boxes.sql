create table if not exists public.fund_trailing_boxes (
  user_id uuid not null references auth.users(id) on delete cascade,
  fund_id text not null,
  tracking_start_date date not null,
  peak_nav numeric not null check (peak_nav > 0),
  peak_date date not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, fund_id)
);

comment on column public.fund_trailing_boxes.fund_id is
  'Stable box key. Current app stores purchase:<fund_purchases.id> so every buy record has an independent box.';

alter table public.fund_trailing_boxes enable row level security;

drop policy if exists "Users can read own trailing boxes" on public.fund_trailing_boxes;
create policy "Users can read own trailing boxes"
  on public.fund_trailing_boxes
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own trailing boxes" on public.fund_trailing_boxes;
create policy "Users can insert own trailing boxes"
  on public.fund_trailing_boxes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own trailing boxes" on public.fund_trailing_boxes;
create policy "Users can update own trailing boxes"
  on public.fund_trailing_boxes
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own trailing boxes" on public.fund_trailing_boxes;
create policy "Users can delete own trailing boxes"
  on public.fund_trailing_boxes
  for delete
  to authenticated
  using (auth.uid() = user_id);
