-- Elucidate Supabase Schema
-- Run this in your Supabase SQL editor to set up the database

-- User settings table
create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  canvas_url text,
  canvas_token text,
  bazaar_key text,
  model text default 'auto:free',
  system_instructions text default '',
  theme text default 'light' check (theme in ('light', 'dark')),
  loading_animation text default 'dots' check (loading_animation in ('dots', 'bar', 'spinner', 'waveform')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- Chat sessions table
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  course_id text,
  canvas_item_type text,
  canvas_item_id text,
  context jsonb,
  created_at timestamptz default now()
);

-- Chat messages table
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table user_settings enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

-- RLS Policies for user_settings
create policy "Users can view own settings"
  on user_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert own settings"
  on user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own settings"
  on user_settings for update
  using (auth.uid() = user_id);

create policy "Users can delete own settings"
  on user_settings for delete
  using (auth.uid() = user_id);

-- RLS Policies for chat_sessions
create policy "Users can view own chat sessions"
  on chat_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own chat sessions"
  on chat_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own chat sessions"
  on chat_sessions for update
  using (auth.uid() = user_id);

create policy "Users can delete own chat sessions"
  on chat_sessions for delete
  using (auth.uid() = user_id);

-- RLS Policies for chat_messages
create policy "Users can view own messages"
  on chat_messages for select
  using (session_id in (select id from chat_sessions where user_id = auth.uid()));

create policy "Users can insert own messages"
  on chat_messages for insert
  with check (session_id in (select id from chat_sessions where user_id = auth.uid()));

create policy "Users can delete own messages"
  on chat_messages for delete
  using (session_id in (select id from chat_sessions where user_id = auth.uid()));

-- Function to auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_settings_updated_at
  before update on user_settings
  for each row execute function update_updated_at();

-- Indexes for performance
create index if not exists idx_chat_sessions_user_id on chat_sessions(user_id);
create index if not exists idx_chat_messages_session_id on chat_messages(session_id);
create index if not exists idx_user_settings_user_id on user_settings(user_id);
