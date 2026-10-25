-- Run against a test database or in a transaction. Every inserted row rolls back.
begin;

do $$
declare
  test_user uuid;
  cash_id uuid;
  test_plan_id uuid;
  old_day date := (now() at time zone 'Asia/Taipei')::date - 150;
  effective_day date := (now() at time zone 'Asia/Taipei')::date + 1;
  recorded_amount numeric;
begin
  select id into test_user from auth.users limit 1;
  if test_user is null then
    raise exception 'Test requires one auth user';
  end if;

  insert into public.fund_purchases (user_id, fund_id, fund_name, buy_date, amount, nav)
  values (test_user, 'manual:recurring-history-test', '資金測試', old_day - 1, 100000, 100)
  returning id into cash_id;

  insert into public.recurring_investment_plans (
    user_id, fund_id, fund_name, monthly_amount, debit_day, start_date,
    cash_source_id, auto_start_date
  ) values (
    test_user, 'recurring-history-test:' || gen_random_uuid(), '定期定額測試',
    10000, extract(day from old_day)::integer, old_day, cash_id, old_day
  ) returning id into test_plan_id;

  update public.recurring_investment_plans
  set monthly_amount = 20000 where id = test_plan_id;

  select amount into recorded_amount from public.recurring_plan_amount_history history
  where history.plan_id = test_plan_id and history.effective_date = old_day;
  if recorded_amount <> 10000 then
    raise exception 'Old scheduled dates must keep the original 10000';
  end if;

  select amount into recorded_amount from public.recurring_plan_amount_history history
  where history.plan_id = test_plan_id and history.effective_date = effective_day;
  if recorded_amount <> 20000 then
    raise exception 'Tomorrow must use the changed 20000';
  end if;

  insert into public.fund_purchases (
    user_id, fund_id, fund_name, buy_date, amount, nav,
    recurring_plan_id, cash_source_id, scheduled_date
  ) select test_user, fund_id, fund_name, old_day, 20000, 100,
           test_plan_id, cash_id, old_day
    from public.recurring_investment_plans where id = test_plan_id
  returning amount into recorded_amount;
  if recorded_amount <> 10000 then
    raise exception 'An old pending debit must post at 10000, not the current 20000';
  end if;

  update public.recurring_investment_plans
  set monthly_amount = 25000 where id = test_plan_id;
  select amount into recorded_amount from public.recurring_plan_amount_history history
  where history.plan_id = test_plan_id and history.effective_date = effective_day;
  if recorded_amount <> 25000 then
    raise exception 'Multiple same-day edits must use the last amount on the next day';
  end if;
end;
$$;

rollback;
