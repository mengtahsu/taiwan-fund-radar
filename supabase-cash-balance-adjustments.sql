create table if not exists public.cash_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cash_purchase_id uuid not null references public.fund_purchases(id) on delete cascade,
  effective_date date not null,
  delta numeric not null check (delta <> 0),
  created_at timestamptz not null default now()
);

create index if not exists cash_balance_adjustments_source_date_idx
  on public.cash_balance_adjustments (user_id, cash_purchase_id, effective_date);

alter table public.cash_balance_adjustments enable row level security;

drop policy if exists "Users can read own cash adjustments" on public.cash_balance_adjustments;
create policy "Users can read own cash adjustments"
  on public.cash_balance_adjustments for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.cash_balance_adjustments from anon;
revoke insert, update, delete on public.cash_balance_adjustments from authenticated;
grant select on public.cash_balance_adjustments to authenticated;

create or replace function public.set_cash_balance(
  p_cash_purchase_id uuid, p_target_balance numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_record public.fund_purchases%rowtype;
  balance_before numeric;
  adjustment_id uuid;
  today_taiwan date := (now() at time zone 'Asia/Taipei')::date;
begin
  if auth.uid() is null or p_target_balance is null
     or p_target_balance < 0 or p_target_balance <> trunc(p_target_balance) then
    raise exception 'Invalid cash balance';
  end if;
  select * into source_record from public.fund_purchases
    where id = p_cash_purchase_id and user_id = auth.uid() for update;
  if source_record.id is null or source_record.fund_id not like 'manual:%'
     or source_record.fund_name not like '資金%'
     or source_record.sell_date is not null or source_record.buy_date > today_taiwan then
    raise exception 'Cash source is unavailable';
  end if;

  select source_record.amount
    + coalesce((select sum(delta) from public.cash_balance_adjustments
                where cash_purchase_id = source_record.id and effective_date <= today_taiwan), 0)
    - coalesce((select sum(amount) from public.fund_purchases
                where cash_source_id = source_record.id
                  and coalesce(scheduled_date, buy_date) <= today_taiwan), 0)
  into balance_before;

  if p_target_balance < coalesce((select sum(amount) from public.fund_purchases
      where cash_source_id = source_record.id
        and coalesce(scheduled_date, buy_date) > today_taiwan), 0) then
    raise exception 'Cash balance cannot cover future deductions';
  end if;
  if p_target_balance = balance_before then
    return null;
  end if;
  insert into public.cash_balance_adjustments (
    user_id, cash_purchase_id, effective_date, delta
  ) values (
    auth.uid(), source_record.id, today_taiwan, p_target_balance - balance_before
  ) returning id into adjustment_id;
  return adjustment_id;
end;
$$;

revoke all on function public.set_cash_balance(uuid, numeric) from public;
grant execute on function public.set_cash_balance(uuid, numeric) to authenticated;

create or replace function public.validate_recurring_cash_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  source_record public.fund_purchases%rowtype;
  plan_record public.recurring_investment_plans%rowtype;
  invalid_balance boolean;
begin
  if new.cash_source_id is null then
    if new.scheduled_date is not null then
      raise exception 'A scheduled purchase needs a cash source';
    end if;
    return new;
  end if;
  select * into source_record from public.fund_purchases
    where id = new.cash_source_id for update;
  select * into plan_record from public.recurring_investment_plans
    where id = new.recurring_plan_id;
  if source_record.id is null or plan_record.id is null
     or source_record.user_id <> new.user_id
     or plan_record.user_id <> new.user_id
     or plan_record.fund_id <> new.fund_id
     or plan_record.cash_source_id is distinct from source_record.id
     or source_record.fund_id not like 'manual:%'
     or source_record.fund_name not like '資金%'
     or source_record.sell_date is not null
     or source_record.buy_date > new.buy_date
     or new.scheduled_date is null then
    raise exception 'Cash source, plan, fund or purchase date does not match';
  end if;

  select exists (
    select 1 from (
      select new.scheduled_date as date
      union
      select coalesce(p.scheduled_date, p.buy_date) from public.fund_purchases p
        where p.cash_source_id = source_record.id and p.id is distinct from new.id
      union
      select a.effective_date from public.cash_balance_adjustments a
        where a.cash_purchase_id = source_record.id
    ) dates
    where dates.date >= new.scheduled_date
      and source_record.amount
        + coalesce((select sum(a.delta) from public.cash_balance_adjustments a
                    where a.cash_purchase_id = source_record.id and a.effective_date <= dates.date), 0)
        - coalesce((select sum(p.amount) from public.fund_purchases p
                    where p.cash_source_id = source_record.id and p.id is distinct from new.id
                      and coalesce(p.scheduled_date, p.buy_date) <= dates.date), 0)
        - new.amount < 0
  ) into invalid_balance;
  if invalid_balance then
    raise exception 'Insufficient recorded cash balance';
  end if;
  return new;
end;
$$;

create or replace function public.protect_adjusted_cash_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.cash_balance_adjustments where cash_purchase_id = old.id)
     and (new.amount is distinct from old.amount
       or new.buy_date is distinct from old.buy_date
       or new.sell_date is distinct from old.sell_date
       or new.fund_id is distinct from old.fund_id
       or new.fund_name is distinct from old.fund_name) then
    raise exception 'Cash source with balance history cannot change its original amount, date or identity';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_adjusted_cash_source_trigger on public.fund_purchases;
create trigger protect_adjusted_cash_source_trigger
  before update of amount, buy_date, sell_date, fund_id, fund_name on public.fund_purchases
  for each row execute function public.protect_adjusted_cash_source();
