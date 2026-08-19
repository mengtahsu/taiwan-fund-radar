create table if not exists public.market_quote_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.market_quote_cache enable row level security;

revoke all on table public.market_quote_cache from anon, authenticated;
grant all on table public.market_quote_cache to service_role;
