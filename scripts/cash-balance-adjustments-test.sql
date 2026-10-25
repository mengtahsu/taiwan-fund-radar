begin;

do $$
declare
  test_user uuid;
  cash_id uuid;
  plan_id uuid;
  today_taiwan date := (now() at time zone 'Asia/Taipei')::date;
  first_adjustment uuid;
  current_cash numeric;
begin
  select id into test_user from auth.users order by created_at limit 1;
  if test_user is null then
    raise exception 'No test user is available';
  end if;
  perform set_config('request.jwt.claim.sub', test_user::text, true);
  insert into public.fund_purchases (
    user_id, fund_id, fund_name, buy_date, amount, nav
  ) values (
    test_user, 'manual:cash-ledger-test', '資金測試', today_taiwan - 1, 300000, 100
  ) returning id into cash_id;

  first_adjustment := public.set_cash_balance(cash_id, 280000);
  if first_adjustment is null or public.set_cash_balance(cash_id, 280000) is not null then
    raise exception 'Setting the same target twice must be idempotent';
  end if;
  if (select count(*) from public.cash_balance_adjustments where cash_purchase_id = cash_id) <> 1 then
    raise exception 'Unexpected adjustment count';
  end if;
  if (select amount from public.fund_purchases where id = cash_id) <> 300000 then
    raise exception 'The original balance was overwritten';
  end if;
  if (select coalesce(sum(delta), 0) from public.cash_balance_adjustments
      where cash_purchase_id = cash_id and effective_date <= today_taiwan - 1) <> 0 then
    raise exception 'Yesterday was modified';
  end if;

  insert into public.recurring_investment_plans (
    user_id, fund_id, fund_name, monthly_amount, debit_day,
    start_date, cash_source_id, auto_start_date
  ) values (
    test_user, 'test:cash-ledger-' || cash_id::text, '測試基金', 10000, 1,
    today_taiwan - 1, cash_id, today_taiwan - 1
  ) returning id into plan_id;
  insert into public.fund_purchases (
    user_id, fund_id, fund_name, buy_date, amount, nav,
    recurring_plan_id, cash_source_id, scheduled_date
  ) values (
    test_user, 'test:cash-ledger-' || cash_id::text, '測試基金', today_taiwan,
    10000, 100, plan_id, cash_id, today_taiwan
  );

  select 300000 + coalesce((select sum(delta) from public.cash_balance_adjustments
    where cash_purchase_id = cash_id), 0) - coalesce((select sum(amount) from public.fund_purchases
    where cash_source_id = cash_id), 0) into current_cash;
  if current_cash <> 270000 then
    raise exception 'Cash deduction was counted incorrectly: %', current_cash;
  end if;
  perform public.set_cash_balance(cash_id, 260000);
  perform public.set_cash_balance(cash_id, 290000);
  if (select sum(delta) from public.cash_balance_adjustments where cash_purchase_id = cash_id) <> 0 then
    raise exception 'Deposits and spending were counted incorrectly';
  end if;

  begin
    insert into public.fund_purchases (
      user_id, fund_id, fund_name, buy_date, amount, nav,
      recurring_plan_id, cash_source_id, scheduled_date
    ) values (
      test_user, 'test:cash-ledger-' || cash_id::text, '測試基金', today_taiwan,
      290001, 100, plan_id, cash_id, today_taiwan
    );
    raise exception 'Overspending was accepted';
  exception when others then
    if sqlerrm <> 'Insufficient recorded cash balance' then raise; end if;
  end;

  begin
    update public.fund_purchases set amount = 280000 where id = cash_id;
    raise exception 'Original balance was edited after adjustment';
  exception when others then
    if sqlerrm <> 'Cash source with balance history cannot change its original amount, date or identity' then raise; end if;
  end;

  if has_table_privilege('authenticated', 'public.cash_balance_adjustments', 'INSERT') then
    raise exception 'Direct client writes to adjustments must be blocked';
  end if;
end;
$$;

select set_config('test.user_id', (select id::text from auth.users order by created_at limit 1), true);
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.user_id'), true);

with inserted as (
  insert into public.fund_purchases (user_id, fund_id, fund_name, buy_date, amount, nav)
  values (auth.uid(), 'manual:cash-auth-test', '資金驗證', (now() at time zone 'Asia/Taipei')::date - 1, 300000, 100)
  returning id
)
select set_config('test.cash_id', id::text, true) from inserted;

select public.set_cash_balance(current_setting('test.cash_id')::uuid, 280000);

do $$
begin
  if (select sum(delta) from public.cash_balance_adjustments
      where cash_purchase_id = current_setting('test.cash_id')::uuid) <> -20000 then
    raise exception 'Authenticated client could not read its adjustment';
  end if;
end;
$$;

rollback;
