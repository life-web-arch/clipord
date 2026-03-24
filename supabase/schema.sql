-- Enable UUID extension
create extension if not exists "uuid-ossp";

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

-- Spaces table
create table if not exists spaces (
  id                    uuid primary key default uuid_generate_v4(),
  name                  text not null,
  creator_id            uuid not null references auth.users(id) on delete cascade,
  allow_member_invite   boolean not null default false,
  created_at            timestamptz not null default now()
);

-- Space members table
create table if not exists space_members (
  space_id            uuid not null references spaces(id) on delete cascade,
  account_id          uuid not null references auth.users(id) on delete cascade,
  role                text not null check (role in ('creator','member')),
  encrypted_space_key text not null,
  iv                  text not null,
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

-- Row Level Security
alter table clips         enable row level security;
alter table spaces        enable row level security;
alter table space_members enable row level security;
alter table space_invites enable row level security;

-- Clips: personal (user can only see their own personal clips)
create policy "personal clips" on clips
  for all using (
    account_id = auth.uid() and space_id is null
  );

-- Clips: space clips (user must be a space member)
create policy "space clips" on clips
  for all using (
    space_id in (
      select space_id from space_members where account_id = auth.uid()
    )
  );

-- Spaces: members can see spaces they belong to
create policy "space visibility" on spaces
  for select using (
    id in (select space_id from space_members where account_id = auth.uid())
  );

-- Space members: users can see their own memberships
create policy "own memberships" on space_members
  for select using (account_id = auth.uid());

-- Space members: can see co-members in shared spaces
create policy "co-member visibility" on space_members
  for select using (
    space_id in (select space_id from space_members where account_id = auth.uid())
  );

-- Space invites: creator can manage, members can insert if allowed
create policy "invite visibility" on space_invites
  for select using (
    space_id in (select space_id from space_members where account_id = auth.uid())
  );

-- Enable realtime for clips
alter publication supabase_realtime add table clips;
alter publication supabase_realtime add table space_invites;
