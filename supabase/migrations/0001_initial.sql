create extension if not exists pgcrypto;

create table if not exists public.linkedin_credentials (
  id text primary key check (id = 'primary'),
  member_id text not null,
  member_name text,
  member_email text,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  scopes text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_posts (
  id uuid primary key default gen_random_uuid(),
  scheduled_day date not null unique,
  topic text not null,
  text text not null,
  sources jsonb not null default '[]'::jsonb,
  content_hash text not null,
  status text not null check (status in ('draft','blocked','publishing','published','failed')),
  quality_checks jsonb not null default '{}'::jsonb,
  linkedin_post_urn text,
  linkedin_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists public.publishing_events (
  id bigint generated always as identity primary key,
  post_id uuid references public.daily_posts(id) on delete set null,
  event_type text not null,
  status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists publishing_events_created_at_idx on public.publishing_events (created_at desc);
create index if not exists daily_posts_status_idx on public.daily_posts (status, created_at desc);

-- Service-role-only access. The anon/authenticated roles receive no table privileges.
alter table public.linkedin_credentials enable row level security;
alter table public.daily_posts enable row level security;
alter table public.publishing_events enable row level security;
revoke all on public.linkedin_credentials from anon, authenticated;
revoke all on public.daily_posts from anon, authenticated;
revoke all on public.publishing_events from anon, authenticated;
grant all on public.linkedin_credentials to service_role;
grant all on public.daily_posts to service_role;
grant all on public.publishing_events to service_role;
grant usage, select on sequence public.publishing_events_id_seq to service_role;
