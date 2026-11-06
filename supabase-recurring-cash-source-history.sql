-- Run after recurring auto-debits, cash balance adjustments, and amount history.
-- Existing purchases are never rewritten when future cash sources change.
alter table public.recurring_investment_plans
  add column if not exists cash_source_effective_date date;

create table if not exists public.recurring_plan_cash_source_history (
  plan_id uuid not null references public.recurring_investment_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_date date not null,
  cash_source_id uuid not null references public.fund_purchases(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (plan_id, effective_date)
);
alter table public.recurring_plan_cash_source_history enable row level security;
revoke all on public.recurring_plan_cash_source_history from anon, authenticated;
grant select on public.recurring_plan_cash_source_history to authenticated;
drop policy if exists "Users can read own recurring source history" on public.recurring_plan_cash_source_history;
create policy "Users can read own recurring source history"
  on public.recurring_plan_cash_source_history for select to authenticated
  using (auth.uid() = user_id);

insert into public.recurring_plan_cash_source_history (plan_id, user_id, effective_date, cash_source_id)
select id, user_id, start_date, cash_source_id from public.recurring_investment_plans
where cash_source_id is not null
on conflict (plan_id, effective_date) do nothing;
update public.recurring_investment_plans set cash_source_effective_date = start_date
where cash_source_id is not null and cash_source_effective_date is null;

create or replace function public.recurring_cash_source_for_date(p_plan_id uuid, p_user_id uuid, p_date date)
returns uuid
language sql stable
set search_path = public, pg_temp
as $$
  select cash_source_id from public.recurring_plan_cash_source_history
  where plan_id = p_plan_id and user_id = p_user_id and effective_date <= p_date
  order by effective_date desc limit 1;
$$;
revoke all on function public.recurring_cash_source_for_date(uuid, uuid, date) from public;
grant execute on function public.recurring_cash_source_for_date(uuid, uuid, date) to authenticated;

create or replace function public.version_recurring_plan_cash_source()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare source_start date;
begin
  if tg_op = 'INSERT' then
    new.cash_source_effective_date := case when new.cash_source_id is not null then new.start_date else null end;
    return new;
  end if;
  if new.cash_source_id is not distinct from old.cash_source_id then
    new.cash_source_effective_date := old.cash_source_effective_date;
    return new;
  end if;
  if new.cash_source_id is null then
    raise exception 'Pause the plan instead of removing its cash source';
  end if;
  if old.cash_source_id is null then
    new.cash_source_effective_date := new.start_date;
    return new;
  end if;
  if old.auto_start_date is not null then new.auto_start_date := old.auto_start_date; end if;
  select buy_date into source_start from public.fund_purchases
    where id = new.cash_source_id and user_id = new.user_id;
  new.cash_source_effective_date := greatest(new.start_date, source_start, (now() at time zone 'Asia/Taipei')::date + 1);
  if exists (select 1 from public.fund_purchases
      where recurring_plan_id = new.id and scheduled_date >= new.cash_source_effective_date
        and cash_source_id is not null) then
    raise exception 'Future deductions already posted; their source cannot change';
  end if;
  return new;
end;
$$;

-- Resolve source ownership by scheduled date, including late NAV settlement.
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
  if tg_op = 'UPDATE' and old.cash_source_id is not null and
     (new.cash_source_id is distinct from old.cash_source_id
       or new.recurring_plan_id is distinct from old.recurring_plan_id
       or new.scheduled_date is distinct from old.scheduled_date
       or new.user_id is distinct from old.user_id
       or new.fund_id is distinct from old.fund_id) then
    raise exception 'Posted deduction identity cannot change';
  end if;
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
     or public.recurring_cash_source_for_date(new.recurring_plan_id, new.user_id, new.scheduled_date) is distinct from source_record.id
     or source_record.fund_id not like 'manual:%'
     or source_record.fund_name not like '資金%'
     or source_record.sell_date is not null
     or source_record.buy_date > new.buy_date
     or source_record.buy_date > new.scheduled_date
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

create or replace function public.start_recurring_deduction(
  p_plan_id uuid, p_scheduled_date date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  plan_record public.recurring_investment_plans%rowtype;
  source_record public.fund_purchases%rowtype;
  purchase_id uuid;
  last_day integer;
begin
  select * into plan_record from public.recurring_investment_plans
    where id = p_plan_id and user_id = auth.uid() for update;
  if plan_record.id is null or plan_record.paused or plan_record.cash_source_id is null
     or plan_record.auto_start_date is null then
    return null;
  end if;
  last_day := extract(day from (date_trunc('month', p_scheduled_date) + interval '1 month - 1 day'))::integer;
  if p_scheduled_date < plan_record.start_date
     or p_scheduled_date < plan_record.auto_start_date
     or p_scheduled_date > (now() at time zone 'Asia/Taipei')::date
     or extract(day from p_scheduled_date)::integer <> least(plan_record.debit_day, last_day) then
    raise exception 'Invalid scheduled debit date';
  end if;
  if exists (select 1 from public.recurring_deduction_events
             where user_id = auth.uid() and plan_id = p_plan_id and scheduled_date = p_scheduled_date) then
    return null;
  end if;
  if exists (select 1 from public.fund_purchases
             where user_id = auth.uid() and recurring_plan_id = p_plan_id
               and (date_trunc('month', scheduled_date) = date_trunc('month', p_scheduled_date)
                    or (scheduled_date is null and
                      (date_trunc('month', buy_date) = date_trunc('month', p_scheduled_date)
                       or buy_date between p_scheduled_date and p_scheduled_date + 7)))) then
    insert into public.recurring_deduction_events (user_id, plan_id, scheduled_date)
      values (auth.uid(), p_plan_id, p_scheduled_date)
      on conflict do nothing;
    return null;
  end if;
  select * into source_record from public.fund_purchases
    where id = public.recurring_cash_source_for_date(p_plan_id, auth.uid(), p_scheduled_date)
      and user_id = auth.uid() for update;
  if source_record.id is null or source_record.buy_date > p_scheduled_date then
    raise exception 'Cash source is unavailable on the scheduled date';
  end if;
  insert into public.fund_purchases (
    user_id, fund_id, fund_name, buy_date, amount, nav,
    recurring_plan_id, cash_source_id, scheduled_date, note
  ) values (
    auth.uid(), plan_record.fund_id, plan_record.fund_name, p_scheduled_date,
    plan_record.monthly_amount, null, p_plan_id, source_record.id,
    p_scheduled_date, '定期定額待淨值；記帳扣款並非銀行成交確認'
  ) returning id into purchase_id;
  insert into public.recurring_deduction_events (user_id, plan_id, scheduled_date, purchase_id)
    values (auth.uid(), p_plan_id, p_scheduled_date, purchase_id);
  return purchase_id;
end;
$$;

create or replace function public.post_recurring_deduction(
  p_plan_id uuid, p_scheduled_date date, p_nav_date date, p_nav numeric
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  plan_record public.recurring_investment_plans%rowtype;
  source_record public.fund_purchases%rowtype;
  purchase_id uuid;
  last_day integer;
begin
  select * into plan_record from public.recurring_investment_plans
    where id = p_plan_id and user_id = auth.uid() for update;
  if plan_record.id is null or plan_record.paused or plan_record.cash_source_id is null
     or plan_record.auto_start_date is null then
    return null;
  end if;
  last_day := extract(day from (date_trunc('month', p_scheduled_date) + interval '1 month - 1 day'))::integer;
  if p_scheduled_date < plan_record.start_date
     or p_scheduled_date < plan_record.auto_start_date
     or extract(day from p_scheduled_date)::integer <> least(plan_record.debit_day, last_day)
     or p_nav_date < p_scheduled_date
     or p_nav_date > p_scheduled_date + 7
     or p_nav_date > (now() at time zone 'Asia/Taipei')::date
     or p_nav <= 0 then
    raise exception 'Invalid scheduled debit or NAV date';
  end if;
  if exists (select 1 from public.recurring_deduction_events
             where user_id = auth.uid() and plan_id = p_plan_id and scheduled_date = p_scheduled_date) then
    return null;
  end if;
  if exists (select 1 from public.fund_purchases
             where user_id = auth.uid() and recurring_plan_id = p_plan_id
               and (date_trunc('month', scheduled_date) = date_trunc('month', p_scheduled_date)
                    or (scheduled_date is null and
                      (date_trunc('month', buy_date) = date_trunc('month', p_scheduled_date)
                       or buy_date between p_scheduled_date and p_scheduled_date + 7)))) then
    insert into public.recurring_deduction_events (user_id, plan_id, scheduled_date)
      values (auth.uid(), p_plan_id, p_scheduled_date)
      on conflict do nothing;
    return null;
  end if;
  select * into source_record from public.fund_purchases
    where id = public.recurring_cash_source_for_date(p_plan_id, auth.uid(), p_scheduled_date)
      and user_id = auth.uid() for update;
  if source_record.id is null or source_record.buy_date > p_nav_date then
    raise exception 'Cash source is unavailable on the NAV date';
  end if;
  insert into public.fund_purchases (
    user_id, fund_id, fund_name, buy_date, amount, nav,
    recurring_plan_id, cash_source_id, scheduled_date, note
  ) values (
    auth.uid(), plan_record.fund_id, plan_record.fund_name, p_nav_date,
    plan_record.monthly_amount, p_nav, p_plan_id, source_record.id,
    p_scheduled_date, '定期定額估算；請依銀行對帳單核對實際成交日與淨值'
  ) returning id into purchase_id;
  insert into public.recurring_deduction_events (user_id, plan_id, scheduled_date, purchase_id)
    values (auth.uid(), p_plan_id, p_scheduled_date, purchase_id);
  return purchase_id;
end;
$$;

create or replace function public.settle_recurring_deduction(
  p_plan_id uuid, p_scheduled_date date, p_nav_date date, p_nav numeric
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  plan_record public.recurring_investment_plans%rowtype;
  purchase_record public.fund_purchases%rowtype;
begin
  select * into plan_record from public.recurring_investment_plans
    where id = p_plan_id and user_id = auth.uid() for update;
  if plan_record.id is null then
    return null;
  end if;
  if p_nav_date < p_scheduled_date or p_nav_date > p_scheduled_date + 7
     or p_nav_date > (now() at time zone 'Asia/Taipei')::date or p_nav <= 0 then
    raise exception 'Invalid published NAV date or value';
  end if;
  select purchase.* into purchase_record
  from public.recurring_deduction_events event
  join public.fund_purchases purchase on purchase.id = event.purchase_id
  where event.user_id = auth.uid() and event.plan_id = p_plan_id
    and event.scheduled_date = p_scheduled_date
    and purchase.user_id = auth.uid() and purchase.fund_id = plan_record.fund_id
    and purchase.recurring_plan_id = p_plan_id
    and purchase.cash_source_id = public.recurring_cash_source_for_date(p_plan_id, auth.uid(), p_scheduled_date)
    and purchase.scheduled_date = p_scheduled_date
  for update of purchase;
  if purchase_record.id is null or purchase_record.nav > 0 then
    return null;
  end if;
  update public.fund_purchases
  set buy_date = p_nav_date,
      nav = p_nav,
      note = '定期定額估算；請依銀行對帳單核對實際成交日與淨值',
      updated_at = now()
  where id = purchase_record.id;
  return purchase_record.id;
end;
$$;
drop trigger if exists version_recurring_plan_cash_source_trigger on public.recurring_investment_plans;
create trigger version_recurring_plan_cash_source_trigger
  before insert or update of cash_source_id, cash_source_effective_date, start_date, auto_start_date
  on public.recurring_investment_plans
  for each row execute function public.version_recurring_plan_cash_source();

create or replace function public.remember_recurring_plan_cash_source()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare initial_source uuid;
begin
  if new.cash_source_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.start_date < old.start_date then
      select cash_source_id into initial_source from public.recurring_plan_cash_source_history
      where plan_id = new.id order by effective_date limit 1;
      insert into public.recurring_plan_cash_source_history (plan_id, user_id, effective_date, cash_source_id)
      values (new.id, new.user_id, new.start_date, coalesce(initial_source, old.cash_source_id, new.cash_source_id))
      on conflict (plan_id, effective_date) do nothing;
    end if;
    if new.cash_source_id is not distinct from old.cash_source_id then return new; end if;
  end if;
  insert into public.recurring_plan_cash_source_history (plan_id, user_id, effective_date, cash_source_id)
  values (new.id, new.user_id, new.cash_source_effective_date, new.cash_source_id)
  on conflict (plan_id, effective_date) do update set cash_source_id = excluded.cash_source_id;
  return new;
end;
$$;
drop trigger if exists remember_recurring_plan_cash_source_trigger on public.recurring_investment_plans;
create trigger remember_recurring_plan_cash_source_trigger
  after insert or update of cash_source_id, start_date on public.recurring_investment_plans
  for each row execute function public.remember_recurring_plan_cash_source();

create or replace function public.apply_recurring_historical_cash_source()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare source_id uuid;
begin
  if new.cash_source_id is null or new.recurring_plan_id is null or new.scheduled_date is null then return new; end if;
  source_id := public.recurring_cash_source_for_date(new.recurring_plan_id, new.user_id, new.scheduled_date);
  if source_id is null then raise exception 'No recurring cash source for scheduled date'; end if;
  new.cash_source_id := source_id;
  return new;
end;
$$;
drop trigger if exists apply_recurring_historical_cash_source_trigger on public.fund_purchases;
create trigger apply_recurring_historical_cash_source_trigger
  before insert on public.fund_purchases
  for each row execute function public.apply_recurring_historical_cash_source();

create or replace function public.keep_recurring_cash_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.fund_purchases where recurring_plan_id = old.id and cash_source_id is not null) then
      raise exception 'Pause the plan; posted cash deductions must retain their plan';
    end if;
    return old;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
