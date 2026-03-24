-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Spaces table (before clips — clips reference it)
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

-- Row Level Security
alter table clips              enable row level security;
alter table spaces             enable row level security;
alter table space_members      enable row level security;
alter table space_invites      enable row level security;
alter table push_subscriptions enable row level security;

-- Clips: personal
drop policy if exists "personal clips" on clips;
create policy "personal clips" on clips
  for all using (account_id = auth.uid() and space_id is null);

-- Clips: space clips
drop policy if exists "space clips" on clips;
create policy "space clips" on clips
  for all using (
    space_id in (
      select space_id from space_members where account_id = auth.uid()
    )
  );

-- Spaces: select
drop policy if exists "space visibility" on spaces;
create policy "space visibility" on spaces
  for select using (
    id in (select space_id from space_members where account_id = auth.uid())
  );

-- Spaces: insert
drop policy if exists "space insert" on spaces;
create policy "space insert" on spaces
  for insert with check (creator_id = auth.uid());

-- Space members: select own
drop policy if exists "own memberships" on space_members;
create policy "own memberships" on space_members
  for select using (account_id = auth.uid());

-- Space members: select co-members
drop policy if exists "co-member visibility" on space_members;
create policy "co-member visibility" on space_members
  for select using (
    space_id in (select space_id from space_members where account_id = auth.uid())
  );

-- Space members: insert self
drop policy if exists "member self insert" on space_members;
create policy "member self insert" on space_members
  for insert with check (account_id = auth.uid());

-- Space members: creator update
drop policy if exists "creator update members" on space_members;
create policy "creator update members" on space_members
  for update using (
    space_id in (
      select space_id from space_members
      where account_id = auth.uid() and role = 'creator'
    )
  );

-- Space invites: select
drop policy if exists "invite visibility" on space_invites;
create policy "invite visibility" on space_invites
  for select using (
    space_id in (select space_id from space_members where account_id = auth.uid())
    or used_at is null
  );

-- Space invites: insert
drop policy if exists "invite insert" on space_invites;
create policy "invite insert" on space_invites
  for insert with check (created_by = auth.uid());

-- Space invites: update
drop policy if exists "invite update" on space_invites;
create policy "invite update" on space_invites
  for update using (auth.uid() is not null);

-- Push subscriptions: own
drop policy if exists "own push subscription" on push_subscriptions;
create policy "own push subscription" on push_subscriptions
  for all using (account_id = auth.uid());

-- Realtime Configuration (Robust handling for existing publication / tables)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE clips; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE space_invites; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE space_members; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
