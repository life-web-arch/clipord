-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ==========================================
-- 1. TABLE DEFINITIONS
-- ==========================================

-- Spaces table
create table if not exists spaces (
  id                    uuid primary key default uuid_generate_v4(),
  name                  text not null,
  creator_id            uuid not null references auth.users(id) on delete cascade,
  allow_member_invite   boolean not null default false,
  created_at            timestamptz not null default now()
);

-- Clips table
create table if not exists clips (
  id                uuid primary key default uuid_generate_v4(),
  account_id        uuid not null references auth.users(id) on delete cascade,
  space_id          uuid references spaces(id) on delete cascade,
  type              text not null check (type in ('url','otp','phone','address','code','text')),
  preview           text not null,
  encrypted_content text not null,
  iv                text not null,
  pinned            boolean not null default false,
  tags              text[] not null default '{}',
  wipe_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Space members table
create table if not exists space_members (
  space_id            uuid not null references spaces(id) on delete cascade,
  account_id          uuid not null references auth.users(id) on delete cascade,
  role                text not null check (role in ('creator','member')),
  encrypted_space_key text not null default '',
  iv                  text not null default '',
  approved            boolean not null default false,
  joined_at           timestamptz not null default now(),
  primary key (space_id, account_id)
);

-- Space invites table
create table if not exists space_invites (
  id          uuid primary key default uuid_generate_v4(),
  space_id    uuid not null references spaces(id) on delete cascade,
  created_by  uuid not null references auth.users(id) on delete cascade,
  token       text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  approved    boolean not null default false,
  approved_by uuid references auth.users(id)
);

-- Push subscriptions table
create table if not exists push_subscriptions (
  account_id   uuid not null references auth.users(id) on delete cascade,
  subscription text not null,
  updated_at   timestamptz not null default now(),
  primary key (account_id)
);

-- ==========================================
-- 2. ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================

alter table clips              enable row level security;
alter table spaces             enable row level security;
alter table space_members      enable row level security;
alter table space_invites      enable row level security;
alter table push_subscriptions enable row level security;

-- Clear any existing policies to ensure clean application
drop policy if exists "personal clips" on clips;
drop policy if exists "space clips" on clips;
drop policy if exists "space visibility" on spaces;
drop policy if exists "space insert" on spaces;
drop policy if exists "own memberships" on space_members;
drop policy if exists "co-member visibility" on space_members;
drop policy if exists "member visibility" on space_members;
drop policy if exists "member self insert" on space_members;
drop policy if exists "creator update members" on space_members;
drop policy if exists "invite visibility" on space_invites;
drop policy if exists "invite insert" on space_invites;
drop policy if exists "invite update" on space_invites;
drop policy if exists "own push subscription" on push_subscriptions;

-- CLIPS
create policy "personal clips" on clips
  for all using (account_id = auth.uid() and space_id is null)
  with check (account_id = auth.uid() and space_id is null);

create policy "space clips" on clips
  for all using (
    space_id in (
      select space_id from space_members where account_id = auth.uid()
    )
  )
  with check (
    account_id = auth.uid() and
    space_id in (
      select space_id from space_members where account_id = auth.uid()
    )
  );

-- SPACES
-- Fix: Non-recursive visibility. A user can see a space if they are a member OR if an active invite exists.
create policy "space visibility" on spaces
  for select using (
    exists (
      select 1 from space_members sm
      where sm.space_id = id and sm.account_id = auth.uid()
    )
    or
    exists (
      select 1 from space_invites si
      where si.space_id = id and si.used_at is null
    )
  );

create policy "space insert" on spaces
  for insert with check (creator_id = auth.uid());

-- SPACE MEMBERS
-- Fix: Prevent infinite recursion by ONLY allowing users to select their own membership rows
create policy "own memberships" on space_members
  for select using (account_id = auth.uid());

create policy "member self insert" on space_members
  for insert with check (account_id = auth.uid());

create policy "creator update members" on space_members
  for update using (
    exists (
      select 1 from space_members sm
      where sm.space_id = space_members.space_id
      and sm.account_id = auth.uid()
      and sm.role = 'creator'
    )
  );

-- SPACE INVITES
create policy "invite visibility" on space_invites
  for select using (
    space_id in (select space_id from space_members where account_id = auth.uid())
    or used_at is null
  );

create policy "invite insert" on space_invites
  for insert with check (created_by = auth.uid());

create policy "invite update" on space_invites
  for update using (auth.uid() is not null);

-- PUSH SUBSCRIPTIONS
create policy "own push subscription" on push_subscriptions
  for all using (account_id = auth.uid());


-- ==========================================
-- 3. REALTIME CONFIGURATION
-- ==========================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE clips; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE spaces; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE space_invites; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE space_members; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
