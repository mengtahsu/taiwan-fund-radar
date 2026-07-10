alter table public.fund_purchases
  add column if not exists sell_date date,
  add column if not exists sell_nav numeric check (sell_nav is null or sell_nav >= 0),
  add column if not exists sell_amount numeric check (sell_amount is null or sell_amount >= 0);
