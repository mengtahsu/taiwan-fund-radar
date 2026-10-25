create extension if not exists pgcrypto;

create table if not exists public.recurring_investment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fund_id text not null,
  fund_name text not null,
  monthly_amount numeric not null check (monthly_amount > 0),
  debit_day integer not null check (debit_day between 1 and 31),
  start_date date not null,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recurring_investment_plans_user_idx
  on public.recurring_investment_plans (user_id, paused, debit_day);

create unique index if not exists recurring_investment_plans_unique_day_idx
  on public.recurring_investment_plans (user_id, fund_id, debit_day);

alter table public.recurring_investment_plans enable row level security;

drop policy if exists "Users can read own recurring plans" on public.recurring_investment_plans;
create policy "Users can read own recurring plans"
  on public.recurring_investment_plans for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own recurring plans" on public.recurring_investment_plans;
create policy "Users can insert own recurring plans"
  on public.recurring_investment_plans for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own recurring plans" on public.recurring_investment_plans;
create policy "Users can update own recurring plans"
  on public.recurring_investment_plans for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own recurring plans" on public.recurring_investment_plans;
create policy "Users can delete own recurring plans"
  on public.recurring_investment_plans for delete to authenticated
  using (auth.uid() = user_id);

alter table public.fund_purchases
  add column if not exists recurring_plan_id uuid
    references public.recurring_investment_plans(id) on delete set null;

create index if not exists fund_purchases_recurring_plan_idx
  on public.fund_purchases (user_id, recurring_plan_id, buy_date desc);

create or replace function public.validate_recurring_purchase()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.recurring_plan_id is not null and not exists (
    select 1
    from public.recurring_investment_plans plan
    where plan.id = new.recurring_plan_id
      and plan.user_id = new.user_id
      and plan.fund_id = new.fund_id
  ) then
    raise exception 'Recurring plan must belong to the same user and fund';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_recurring_purchase_trigger on public.fund_purchases;
create trigger validate_recurring_purchase_trigger
  before insert or update of recurring_plan_id, fund_id, user_id
  on public.fund_purchases
  for each row execute function public.validate_recurring_purchase();

create or replace function public.keep_recurring_plan_fund()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.fund_id <> old.fund_id and exists (
    select 1 from public.fund_purchases
    where recurring_plan_id = old.id
  ) then
    raise exception 'A recurring plan with purchases cannot change funds';
  end if;
  return new;
end;
$$;

drop trigger if exists keep_recurring_plan_fund_trigger on public.recurring_investment_plans;
create trigger keep_recurring_plan_fund_trigger
  before update of fund_id on public.recurring_investment_plans
  for each row execute function public.keep_recurring_plan_fund();
