-- Every fixture and simulated date boundary rolls back. No user trades change.
begin;
do $$
declare
  test_user uuid;
  old_cash uuid;
  new_cash uuid;
  third_cash uuid;
  test_plan_id uuid;
  old_purchase uuid;
  backfill uuid;
  new_purchase uuid;
  original_pending jsonb;
  month_plan_id uuid;
  month_cash uuid;
  month_purchase uuid;
  old_month_end date;
  next_month_end date;
  today_taiwan date := (now() at time zone 'Asia/Taipei')::date;
  old_day date := ((now() at time zone 'Asia/Taipei')::date - interval '1 month')::date;
  older_day date := ((now() at time zone 'Asia/Taipei')::date - interval '2 months')::date;
begin
  select id into test_user from auth.users order by created_at limit 1;
  if test_user is null then raise exception 'Test requires one auth user'; end if;
  perform set_config('request.jwt.claim.sub', test_user::text, true);
  insert into public.fund_purchases (user_id, fund_id, fund_name, buy_date, amount, nav)
  values (test_user, 'manual:source-old-' || gen_random_uuid(), '資金舊來源', older_day - 2, 300000, 100)
  returning id into old_cash;
  insert into public.fund_purchases (user_id, fund_id, fund_name, buy_date, amount, nav)
  values (test_user, 'manual:source-new-' || gen_random_uuid(), '資金新來源', today_taiwan, 200000, 100)
  returning id into new_cash;
  insert into public.fund_purchases (user_id, fund_id, fund_name, buy_date, amount, nav)
  values (test_user, 'manual:source-third-' || gen_random_uuid(), '資金第三來源', today_taiwan, 200000, 100)
  returning id into third_cash;
  insert into public.recurring_investment_plans (
    user_id, fund_id, fund_name, monthly_amount, debit_day, start_date, cash_source_id, auto_start_date
  ) values (test_user, 'source-test:' || gen_random_uuid(), '來源切換測試', 10000,
    extract(day from today_taiwan)::integer, older_day - 1, old_cash, older_day - 1)
  returning id into test_plan_id;
  old_purchase := public.start_recurring_deduction(test_plan_id, old_day);
  if old_purchase is null then raise exception 'Could not create old pending debit'; end if;
  select to_jsonb(p) into original_pending from public.fund_purchases p where id = old_purchase;
  update public.recurring_investment_plans
    set cash_source_id = new_cash, monthly_amount = 20000, auto_start_date = today_taiwan
    where id = test_plan_id;
  if (select auto_start_date from public.recurring_investment_plans where id = test_plan_id) <> older_day - 1 then
    raise exception 'Changing sources reset historical auto-start coverage';
  end if;
  if (select cash_source_effective_date from public.recurring_investment_plans where id = test_plan_id) <> today_taiwan + 1 then
    raise exception 'New source must start tomorrow in Taiwan';
  end if;
  if public.recurring_cash_source_for_date(test_plan_id, test_user, today_taiwan) <> old_cash
     or public.recurring_cash_source_for_date(test_plan_id, test_user, today_taiwan + 1) <> new_cash then
    raise exception 'Cash source history used the wrong date boundary';
  end if;
  if (select to_jsonb(p) from public.fund_purchases p where id = old_purchase) is distinct from original_pending then
    raise exception 'Changing the plan rewrote an existing pending debit';
  end if;
  update public.recurring_investment_plans set cash_source_id = third_cash where id = test_plan_id;
  update public.recurring_investment_plans set cash_source_id = new_cash where id = test_plan_id;
  if (select count(*) from public.recurring_plan_cash_source_history where recurring_plan_cash_source_history.plan_id = test_plan_id) < 2 then
    raise exception 'Source history was not retained';
  end if;
  if public.recurring_cash_source_for_date(test_plan_id, test_user, today_taiwan + 1) <> new_cash then
    raise exception 'Repeated same-day changes must use the last choice tomorrow';
  end if;
  backfill := public.start_recurring_deduction(test_plan_id, older_day);
  if backfill is null or (select cash_source_id from public.fund_purchases where id = backfill) <> old_cash
     or (select amount from public.fund_purchases where id = backfill) <> 10000 then
    raise exception 'Backfill used the new source or new amount for an old month';
  end if;
  if public.settle_recurring_deduction(test_plan_id, old_day, old_day + 1, 100) <> old_purchase then
    raise exception 'An old pending purchase could not settle after source switching';
  end if;
  if (select cash_source_id from public.fund_purchases where id = old_purchase) <> old_cash
     or (select amount from public.fund_purchases where id = old_purchase) <> 10000 then
    raise exception 'Old settlement moved or recounted cash';
  end if;
  begin
    update public.fund_purchases set cash_source_id = new_cash where id = old_purchase;
    raise exception 'An existing debit was allowed to change source';
  exception when others then
    if sqlerrm <> 'Posted deduction identity cannot change' then raise; end if;
  end;
  begin
    delete from public.recurring_investment_plans where id = test_plan_id;
    raise exception 'A plan with posted deductions was deleted';
  exception when others then
    if sqlerrm <> 'Pause the plan; posted cash deductions must retain their plan' then raise; end if;
  end;
  update public.recurring_investment_plans set cash_source_effective_date = older_day where id = test_plan_id;
  if (select cash_source_effective_date from public.recurring_investment_plans where id = test_plan_id) <> today_taiwan + 1 then
    raise exception 'A client could backdate the source change';
  end if;

  -- Simulate crossing midnight for this fixture only, so the real RPC can run
  -- with a past/present date while still enforcing its future-date prohibition.
  update public.recurring_plan_cash_source_history h set effective_date = today_taiwan
    where h.plan_id = test_plan_id and h.effective_date = today_taiwan + 1;
  update public.recurring_plan_amount_history h set effective_date = today_taiwan
    where h.plan_id = test_plan_id and h.effective_date = today_taiwan + 1;
  new_purchase := public.start_recurring_deduction(test_plan_id, today_taiwan);
  if new_purchase is null or (select cash_source_id from public.fund_purchases where id = new_purchase) <> new_cash
     or (select amount from public.fund_purchases where id = new_purchase) <> 20000 then
    raise exception 'The next debit did not use the new source and amount';
  end if;
  if public.start_recurring_deduction(test_plan_id, today_taiwan) is not null then
    raise exception 'Repeated synchronization duplicated the debit';
  end if;
  if public.post_recurring_deduction(test_plan_id, today_taiwan, today_taiwan, 100) is not null then
    raise exception 'The legacy RPC duplicated a pending debit';
  end if;
  perform set_config('test.source_today_purchase', new_purchase::text, true);
  if (select sum(amount) from public.fund_purchases where cash_source_id = old_cash) <> 20000
     or (select sum(amount) from public.fund_purchases where cash_source_id = new_cash) <> 20000 then
    raise exception 'Cash was deducted from the wrong source or counted twice';
  end if;
  if has_table_privilege('authenticated', 'public.recurring_plan_cash_source_history', 'INSERT,UPDATE,DELETE') then
    raise exception 'Source history must be read-only to clients';
  end if;

  -- A month-end debit settling in the following month must not block that
  -- following month's new debit, including when its cash source has changed.
  old_month_end := (date_trunc('month', today_taiwan) - interval '1 month' - interval '1 day')::date;
  next_month_end := (date_trunc('month', today_taiwan) - interval '1 day')::date;
  insert into public.fund_purchases (user_id, fund_id, fund_name, buy_date, amount, nav)
  values (test_user, 'manual:month-source-' || gen_random_uuid(), '資金月底測試', older_day - 2, 200000, 100)
  returning id into month_cash;
  insert into public.recurring_investment_plans (
    user_id, fund_id, fund_name, monthly_amount, debit_day, start_date, cash_source_id, auto_start_date
  ) values (test_user, 'source-month-test:' || gen_random_uuid(), '跨月來源測試', 10000,
    31, older_day - 2, old_cash, older_day - 2)
  returning id into month_plan_id;
  month_purchase := public.start_recurring_deduction(month_plan_id, old_month_end);
  if public.settle_recurring_deduction(month_plan_id, old_month_end, old_month_end + 1, 100) <> month_purchase then
    raise exception 'Month-end fixture could not settle';
  end if;
  update public.recurring_investment_plans set cash_source_id = month_cash where id = month_plan_id;
  update public.recurring_plan_cash_source_history h set effective_date = old_month_end + 1
    where h.plan_id = month_plan_id and h.effective_date = today_taiwan + 1;
  new_purchase := public.start_recurring_deduction(month_plan_id, next_month_end);
  if new_purchase is null or (select cash_source_id from public.fund_purchases where id = new_purchase) <> month_cash then
    raise exception 'Cross-month settlement incorrectly blocked the new source debit';
  end if;
  if (select cash_source_id from public.fund_purchases where id = month_purchase) <> old_cash then
    raise exception 'Cross-month source change rewrote the previous debit';
  end if;
  perform set_config('test.source_user', test_user::text, true);
  perform set_config('test.source_plan', test_plan_id::text, true);
  perform set_config('test.source_third', third_cash::text, true);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.source_user'), true);
update public.recurring_investment_plans set cash_source_id = current_setting('test.source_third')::uuid
where id = current_setting('test.source_plan')::uuid;
do $$
begin
  if public.recurring_cash_source_for_date(current_setting('test.source_plan')::uuid, auth.uid(),
      (now() at time zone 'Asia/Taipei')::date + 1) <> current_setting('test.source_third')::uuid then
    raise exception 'Authenticated clients cannot change only future cash sources';
  end if;
  if public.settle_recurring_deduction(current_setting('test.source_plan')::uuid,
      (now() at time zone 'Asia/Taipei')::date, (now() at time zone 'Asia/Taipei')::date, 100)
      <> current_setting('test.source_today_purchase')::uuid then
    raise exception 'Authenticated settlement failed after another future source change';
  end if;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  if exists (select 1 from public.recurring_plan_cash_source_history where plan_id = current_setting('test.source_plan')::uuid) then
    raise exception 'Source history leaked across accounts';
  end if;
  if public.start_recurring_deduction(current_setting('test.source_plan')::uuid,
      (now() at time zone 'Asia/Taipei')::date) is not null then
    raise exception 'Another account could start this plan';
  end if;
end;
$$;
reset role;
rollback;
