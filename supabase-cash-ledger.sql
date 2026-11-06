-- Run after cash balance adjustments and cash rename. Existing adjustments remain.
alter table public.cash_balance_adjustments
  add column if not exists note text,
  add column if not exists request_id uuid;
create unique index if not exists cash_flow_request_idx
  on public.cash_balance_adjustments (user_id, request_id) where request_id is not null;

create or replace function public.record_cash_flow(
  p_cash_purchase_id uuid, p_effective_date date, p_delta numeric, p_note text, p_request_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  source_record public.fund_purchases%rowtype;
  existing public.cash_balance_adjustments%rowtype;
  adjustment_id uuid;
  invalid_date date;
  today_taiwan date := (now() at time zone 'Asia/Taipei')::date;
begin
  if auth.uid() is null or p_request_id is null or p_effective_date is null
     or p_effective_date > today_taiwan or p_delta is null or p_delta = 0
     or p_delta::text in ('NaN', 'Infinity', '-Infinity') or abs(p_delta) > 9007199254740991
     or p_delta <> trunc(p_delta) or char_length(coalesce(p_note, '')) > 300 then
    raise exception 'Invalid cash flow';
  end if;
  select * into source_record from public.fund_purchases
    where id = p_cash_purchase_id and user_id = auth.uid() for update;
  if source_record.id is null or source_record.fund_id not like 'manual:%'
     or source_record.fund_name not like '資金%' or source_record.sell_date is not null
     or p_effective_date < source_record.buy_date then
    raise exception 'Cash source is unavailable on this date';
  end if;
  select * into existing from public.cash_balance_adjustments
    where user_id = auth.uid() and request_id = p_request_id;
  if existing.id is not null then
    if existing.cash_purchase_id is distinct from p_cash_purchase_id
       or existing.effective_date is distinct from p_effective_date
       or existing.delta is distinct from p_delta
       or coalesce(existing.note, '') is distinct from btrim(coalesce(p_note, '')) then
      raise exception 'Request id already used with different cash flow';
    end if;
    return existing.id;
  end if;
  select dates.date into invalid_date from (
    select p_effective_date as date
    union select effective_date from public.cash_balance_adjustments where cash_purchase_id = source_record.id
    union select coalesce(scheduled_date, buy_date) from public.fund_purchases where cash_source_id = source_record.id
  ) dates
  where dates.date >= p_effective_date and source_record.amount + p_delta
    + coalesce((select sum(delta) from public.cash_balance_adjustments
      where cash_purchase_id = source_record.id and effective_date <= dates.date), 0)
    - coalesce((select sum(amount) from public.fund_purchases
      where cash_source_id = source_record.id and coalesce(scheduled_date, buy_date) <= dates.date), 0) < 0
  order by dates.date limit 1;
  if invalid_date is not null then
    raise exception 'Insufficient recorded cash balance on %', invalid_date;
  end if;
  insert into public.cash_balance_adjustments (user_id, cash_purchase_id, effective_date, delta, note, request_id)
  values (auth.uid(), source_record.id, p_effective_date, p_delta, nullif(btrim(p_note), ''), p_request_id)
  returning id into adjustment_id;
  return adjustment_id;
end;
$$;
revoke all on function public.record_cash_flow(uuid, date, numeric, text, uuid) from public;
grant execute on function public.record_cash_flow(uuid, date, numeric, text, uuid) to authenticated;

create or replace function public.protect_cash_ledger()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.fund_id not like 'manual:%' or old.fund_name not like '資金%' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users where id = old.user_id) then
      raise exception 'Cash ledger cannot be deleted; record a withdrawal instead';
    end if;
    return old;
  end if;
  if new.amount is distinct from old.amount or new.buy_date is distinct from old.buy_date
     or new.nav is distinct from old.nav or new.fund_id is distinct from old.fund_id
     or new.sell_date is distinct from old.sell_date or new.user_id is distinct from old.user_id
     or new.fund_name not like '資金%' then
    raise exception 'Cash opening balance is immutable; record a dated cash flow instead';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_cash_ledger_trigger on public.fund_purchases;
create trigger protect_cash_ledger_trigger
  before delete or update of amount, buy_date, nav, fund_id, fund_name, sell_date, user_id on public.fund_purchases
  for each row execute function public.protect_cash_ledger();
