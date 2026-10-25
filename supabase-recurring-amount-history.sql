-- Run after supabase-recurring-auto-debits.sql. Existing plans start with their
-- current amount; later changes are recorded from the next Taiwan calendar day.
create table if not exists public.recurring_plan_amount_history (
  plan_id uuid not null references public.recurring_investment_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_date date not null,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (plan_id, effective_date)
);

alter table public.recurring_plan_amount_history enable row level security;
revoke all on public.recurring_plan_amount_history from anon, authenticated;
grant select on public.recurring_plan_amount_history to authenticated;

drop policy if exists "Users can read own recurring amount history" on public.recurring_plan_amount_history;
create policy "Users can read own recurring amount history"
  on public.recurring_plan_amount_history for select to authenticated
  using (auth.uid() = user_id);

insert into public.recurring_plan_amount_history (plan_id, user_id, effective_date, amount)
select id, user_id, start_date, monthly_amount
from public.recurring_investment_plans
on conflict (plan_id, effective_date) do nothing;

create or replace function public.remember_recurring_plan_amount()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  effective_day date;
  initial_amount numeric;
begin
  if tg_op = 'INSERT' then
    effective_day := new.start_date;
  else
    if new.start_date < old.start_date then
      select amount into initial_amount
      from public.recurring_plan_amount_history
      where plan_id = new.id
      order by effective_date
      limit 1;
      insert into public.recurring_plan_amount_history (plan_id, user_id, effective_date, amount)
      values (new.id, new.user_id, new.start_date, coalesce(initial_amount, new.monthly_amount))
      on conflict (plan_id, effective_date) do nothing;
    end if;
    if new.monthly_amount is not distinct from old.monthly_amount then
      return new;
    end if;
    effective_day := greatest(new.start_date, (now() at time zone 'Asia/Taipei')::date + 1);
  end if;

  insert into public.recurring_plan_amount_history (plan_id, user_id, effective_date, amount)
  values (new.id, new.user_id, effective_day, new.monthly_amount)
  on conflict (plan_id, effective_date) do update set amount = excluded.amount;
  return new;
end;
$$;

drop trigger if exists remember_recurring_plan_amount_trigger on public.recurring_investment_plans;
create trigger remember_recurring_plan_amount_trigger
  after insert or update of monthly_amount, start_date on public.recurring_investment_plans
  for each row execute function public.remember_recurring_plan_amount();

create or replace function public.apply_recurring_historical_amount()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  debit_amount numeric;
begin
  if new.cash_source_id is null or new.recurring_plan_id is null or new.scheduled_date is null then
    return new;
  end if;

  select amount into debit_amount
  from public.recurring_plan_amount_history
  where plan_id = new.recurring_plan_id
    and user_id = new.user_id
    and effective_date <= new.scheduled_date
  order by effective_date desc
  limit 1;
  if debit_amount is null then
    raise exception 'No recurring amount recorded for scheduled date %', new.scheduled_date;
  end if;
  new.amount := debit_amount;
  return new;
end;
$$;

drop trigger if exists apply_recurring_historical_amount_trigger on public.fund_purchases;
create trigger apply_recurring_historical_amount_trigger
  before insert on public.fund_purchases
  for each row execute function public.apply_recurring_historical_amount();
