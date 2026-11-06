-- Synthetic rows only; all data and settings roll back.
begin;
do $$
declare
  test_user uuid;
  cash_id uuid;
  plan_id uuid;
  debit_id uuid;
  request_id uuid := gen_random_uuid();
  first_flow uuid;
  today_taiwan date := (now() at time zone 'Asia/Taipei')::date;
  original_identity jsonb;
  row_count integer;
begin
  select id into test_user from auth.users order by created_at limit 1;
  if test_user is null then raise exception 'Test needs one auth user'; end if;
  perform set_config('request.jwt.claim.sub', test_user::text, true);
  insert into public.fund_purchases (user_id, fund_id, fund_name, buy_date, amount, nav)
  values (test_user, 'manual:cash-ledger-' || gen_random_uuid(), '資金21', today_taiwan - 30, 300000, 100)
  returning id into cash_id;
  select to_jsonb(p) - 'fund_name' - 'updated_at' into original_identity
    from public.fund_purchases p where id = cash_id;
  first_flow := public.record_cash_flow(cash_id, today_taiwan - 2, -20000, '支出測試', request_id);
  if public.record_cash_flow(cash_id, today_taiwan - 2, -20000, '支出測試', request_id) <> first_flow then
    raise exception 'Identical retries must return the existing flow';
  end if;
  if (select count(*) from public.cash_balance_adjustments where cash_purchase_id = cash_id) <> 1 then
    raise exception 'Retry duplicated cash movement';
  end if;
  perform public.record_cash_flow(cash_id, today_taiwan, 10000, '存入測試', gen_random_uuid());
  if (select 300000 + coalesce(sum(delta), 0) from public.cash_balance_adjustments
      where cash_purchase_id = cash_id and effective_date <= today_taiwan - 3) <> 300000 then
    raise exception 'The later expense changed earlier dates';
  end if;
  if (select 300000 + sum(delta) from public.cash_balance_adjustments
      where cash_purchase_id = cash_id and effective_date <= today_taiwan - 1) <> 280000 then
    raise exception 'Yesterday must retain 280000';
  end if;
  if (select 300000 + sum(delta) from public.cash_balance_adjustments
      where cash_purchase_id = cash_id) <> 290000 then
    raise exception 'Today must include the new deposit';
  end if;
  perform public.rename_cash_source(cash_id, '資金');
  if (select to_jsonb(p) - 'fund_name' - 'updated_at' from public.fund_purchases p where id = cash_id)
      is distinct from original_identity then
    raise exception 'Rename altered identity or financial fields';
  end if;
  insert into public.recurring_investment_plans (
    user_id, fund_id, fund_name, monthly_amount, debit_day, start_date, cash_source_id, auto_start_date
  ) values (test_user, 'cash-ledger-test:' || gen_random_uuid(), '測試基金', 10000,
    extract(day from today_taiwan)::integer, today_taiwan - 30, cash_id, today_taiwan - 30)
  returning id into plan_id;
  debit_id := public.start_recurring_deduction(plan_id, today_taiwan);
  if debit_id is null or (select cash_source_id from public.fund_purchases where id = debit_id) <> cash_id then
    raise exception 'Renaming broke recurring deduction links';
  end if;
  if (select 300000 + sum(delta) from public.cash_balance_adjustments where cash_purchase_id = cash_id)
    - (select sum(amount) from public.fund_purchases where cash_source_id = cash_id) <> 280000 then
    raise exception 'Recurring debit was omitted or double counted';
  end if;
  if public.settle_recurring_deduction(plan_id, today_taiwan, today_taiwan, 100) <> debit_id then
    raise exception 'Renamed cash cannot settle a pending purchase';
  end if;
  select count(*) into row_count from public.cash_balance_adjustments where cash_purchase_id = cash_id;
  begin
    perform public.record_cash_flow(cash_id, today_taiwan - 1, -285000, '不能透支', gen_random_uuid());
    raise exception 'An expense making a past balance negative was accepted';
  exception when others then
    if sqlerrm not like 'Insufficient recorded cash balance on %' then raise; end if;
  end;
  begin
    perform public.record_cash_flow(cash_id, today_taiwan, 99999, '不同內容', request_id);
    raise exception 'An existing request id accepted a different payload';
  exception when others then
    if sqlerrm <> 'Request id already used with different cash flow' then raise; end if;
  end;
  begin
    delete from public.fund_purchases where id = cash_id;
    raise exception 'Deleting a cash ledger was accepted';
  exception when others then
    if sqlerrm <> 'Cash ledger cannot be deleted; record a withdrawal instead' then raise; end if;
  end;
  begin
    update public.fund_purchases set buy_date = today_taiwan - 31 where id = cash_id;
    raise exception 'Changing the opening date was accepted';
  exception when others then
    if sqlerrm not in ('Cash opening balance is immutable; record a dated cash flow instead',
      'Cash source with balance history cannot change its original amount, date or identity') then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.record_cash_flow(cash_id, today_taiwan, 10000, '禁止跨帳號', gen_random_uuid());
    raise exception 'Another user could append to this cash ledger';
  exception when others then
    if sqlerrm <> 'Cash source is unavailable on this date' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', test_user::text, true);
  if (select count(*) from public.cash_balance_adjustments where cash_purchase_id = cash_id) <> row_count then
    raise exception 'A rejected transaction changed the ledger';
  end if;
  if has_table_privilege('authenticated', 'public.cash_balance_adjustments', 'INSERT,UPDATE,DELETE') then
    raise exception 'Ledger rows must not be directly mutable';
  end if;
  perform set_config('test.cash_user', test_user::text, true);
  perform set_config('test.cash_id', cash_id::text, true);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.cash_user'), true);
do $$
declare flow_id uuid;
begin
  flow_id := public.record_cash_flow(current_setting('test.cash_id')::uuid,
    (now() at time zone 'Asia/Taipei')::date, 100, 'RLS測試', gen_random_uuid());
  if not exists (select 1 from public.cash_balance_adjustments where id = flow_id) then
    raise exception 'Authenticated user cannot read the saved flow';
  end if;
  perform public.rename_cash_source(current_setting('test.cash_id')::uuid, '資金－備用金');
end;
$$;
reset role;
rollback;
