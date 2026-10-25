alter table public.recurring_investment_plans
  add column if not exists cash_source_id uuid references public.fund_purchases(id) on delete set null,
  add column if not exists auto_start_date date;

alter table public.fund_purchases
  add column if not exists cash_source_id uuid references public.fund_purchases(id) on delete restrict,
  add column if not exists scheduled_date date;

create index if not exists fund_purchases_cash_source_idx
  on public.fund_purchases (user_id, cash_source_id, buy_date);

create table if not exists public.recurring_deduction_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.recurring_investment_plans(id) on delete cascade,
  scheduled_date date not null,
  purchase_id uuid unique references public.fund_purchases(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, plan_id, scheduled_date)
);

alter table public.recurring_deduction_events enable row level security;

drop policy if exists "Users can read own recurring deductions" on public.recurring_deduction_events;
create policy "Users can read own recurring deductions"
  on public.recurring_deduction_events for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own recurring deductions" on public.recurring_deduction_events;
create policy "Users can insert own recurring deductions"
  on public.recurring_deduction_events for insert to authenticated
  with check (auth.uid() = user_id);

create or replace function public.validate_recurring_plan_cash_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.cash_source_id is not null and not exists (
    select 1 from public.fund_purchases source
    where source.id = new.cash_source_id
      and source.user_id = new.user_id
      and source.fund_id like 'manual:%'
      and source.fund_name like '資金%'
      and source.sell_date is null
  ) then
    raise exception 'Plan cash source must be an active cash record owned by the user';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_recurring_plan_cash_source_trigger on public.recurring_investment_plans;
create trigger validate_recurring_plan_cash_source_trigger
  before insert or update of cash_source_id, user_id on public.recurring_investment_plans
  for each row execute function public.validate_recurring_plan_cash_source();

create or replace function public.validate_recurring_cash_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  source_record public.fund_purchases%rowtype;
  plan_record public.recurring_investment_plans%rowtype;
  already_spent numeric;
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

  select coalesce(sum(amount), 0) into already_spent
  from public.fund_purchases
  where cash_source_id = source_record.id and id is distinct from new.id;
  if source_record.amount - already_spent < new.amount then
    raise exception 'Insufficient recorded cash balance';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_recurring_cash_source_trigger on public.fund_purchases;
create trigger validate_recurring_cash_source_trigger
  before insert or update of cash_source_id, recurring_plan_id, fund_id, user_id, buy_date, amount, scheduled_date
  on public.fund_purchases
  for each row execute function public.validate_recurring_cash_source();

create or replace function public.protect_recurring_cash_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  already_spent numeric;
begin
  if exists (select 1 from public.fund_purchases where cash_source_id = new.id) then
    select coalesce(sum(amount), 0) into already_spent
    from public.fund_purchases where cash_source_id = new.id;
    if new.amount < already_spent or new.sell_date is not null
       or new.fund_id not like 'manual:%' or new.fund_name not like '資金%' then
      raise exception 'Cash source has linked deductions';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_recurring_cash_source_trigger on public.fund_purchases;
create trigger protect_recurring_cash_source_trigger
  before update of amount, sell_date, fund_id, fund_name on public.fund_purchases
  for each row execute function public.protect_recurring_cash_source();

create or replace function public.keep_recurring_cash_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.fund_purchases
               where recurring_plan_id = old.id and cash_source_id is not null) then
      raise exception 'Pause the plan; posted cash deductions must retain their plan';
    end if;
    return old;
  end if;
  if new.cash_source_id is distinct from old.cash_source_id and exists (
    select 1 from public.fund_purchases
    where recurring_plan_id = old.id and cash_source_id is not null
  ) then
    raise exception 'A plan with posted deductions cannot change cash sources';
  end if;
  return new;
end;
$$;

drop trigger if exists keep_recurring_cash_source_update_trigger on public.recurring_investment_plans;
create trigger keep_recurring_cash_source_update_trigger
  before update of cash_source_id on public.recurring_investment_plans
  for each row execute function public.keep_recurring_cash_source();

drop trigger if exists keep_recurring_cash_source_delete_trigger on public.recurring_investment_plans;
create trigger keep_recurring_cash_source_delete_trigger
  before delete on public.recurring_investment_plans
  for each row execute function public.keep_recurring_cash_source();

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
               and (date_trunc('month', buy_date) = date_trunc('month', p_scheduled_date)
                    or buy_date between p_scheduled_date and p_scheduled_date + 7)) then
    insert into public.recurring_deduction_events (user_id, plan_id, scheduled_date)
      values (auth.uid(), p_plan_id, p_scheduled_date)
      on conflict do nothing;
    return null;
  end if;
  select * into source_record from public.fund_purchases
    where id = plan_record.cash_source_id and user_id = auth.uid() for update;
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

revoke all on function public.post_recurring_deduction(uuid, date, date, numeric) from public;
grant execute on function public.post_recurring_deduction(uuid, date, date, numeric) to authenticated;

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
               and (date_trunc('month', buy_date) = date_trunc('month', p_scheduled_date)
                    or buy_date between p_scheduled_date and p_scheduled_date + 7)) then
    insert into public.recurring_deduction_events (user_id, plan_id, scheduled_date)
      values (auth.uid(), p_plan_id, p_scheduled_date)
      on conflict do nothing;
    return null;
  end if;
  select * into source_record from public.fund_purchases
    where id = plan_record.cash_source_id and user_id = auth.uid() for update;
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

revoke all on function public.start_recurring_deduction(uuid, date) from public;
grant execute on function public.start_recurring_deduction(uuid, date) to authenticated;

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
    and purchase.cash_source_id = plan_record.cash_source_id
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

revoke all on function public.settle_recurring_deduction(uuid, date, date, numeric) from public;
grant execute on function public.settle_recurring_deduction(uuid, date, date, numeric) to authenticated;
