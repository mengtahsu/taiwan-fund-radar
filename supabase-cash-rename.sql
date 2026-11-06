-- Run after supabase-cash-balance-adjustments.sql. Renaming never changes identity
-- or financial fields, including cash records with adjustments and deductions.
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
       or (new.fund_name is distinct from old.fund_name and new.fund_name not like '資金%')) then
    raise exception 'Cash source with balance history cannot change its original amount, date or identity';
  end if;
  return new;
end;
$$;

create or replace function public.rename_cash_source(p_cash_purchase_id uuid, p_name text)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  source_record public.fund_purchases%rowtype;
  next_name text := btrim(p_name);
begin
  if auth.uid() is null or next_name is null or next_name not like '資金%'
     or char_length(next_name) > 120 then
    raise exception 'Cash name must start with 資金 and contain at most 120 characters';
  end if;
  select * into source_record from public.fund_purchases
    where id = p_cash_purchase_id and user_id = auth.uid() for update;
  if source_record.id is null or source_record.fund_id not like 'manual:%'
     or source_record.fund_name not like '資金%' or source_record.sell_date is not null then
    raise exception 'Cash source is unavailable';
  end if;
  update public.fund_purchases set fund_name = next_name, updated_at = now()
    where id = source_record.id and user_id = auth.uid();
  return source_record.id;
end;
$$;
revoke all on function public.rename_cash_source(uuid, text) from public;
grant execute on function public.rename_cash_source(uuid, text) to authenticated;
