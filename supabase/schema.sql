-- 모두의 AI RAG schema
-- Run once in the Supabase SQL editor, then run: npm run ingest

create extension if not exists vector with schema extensions;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '새 대화',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  page integer,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(4096) not null,
  created_at timestamptz not null default now(),
  unique (source, chunk_index)
);

create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.document_chunks enable row level security;

drop policy if exists "own conversations select" on public.conversations;
drop policy if exists "own conversations insert" on public.conversations;
drop policy if exists "own conversations update" on public.conversations;
drop policy if exists "own conversations delete" on public.conversations;
drop policy if exists "own messages select" on public.messages;
drop policy if exists "own messages insert" on public.messages;
drop policy if exists "own messages update" on public.messages;
drop policy if exists "own messages delete" on public.messages;
drop policy if exists "read document chunks" on public.document_chunks;

create policy "own conversations select"
  on public.conversations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "own conversations insert"
  on public.conversations for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "own conversations update"
  on public.conversations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own conversations delete"
  on public.conversations for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "own messages select"
  on public.messages for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "own messages insert"
  on public.messages for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.conversations
      where id = conversation_id and user_id = (select auth.uid())
    )
  );

create policy "own messages update"
  on public.messages for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own messages delete"
  on public.messages for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "read document chunks"
  on public.document_chunks for select to authenticated
  using (true);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select on public.document_chunks to authenticated;
grant all on public.conversations to service_role;
grant all on public.messages to service_role;
grant all on public.document_chunks to service_role;

create or replace function public.touch_conversation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.conversations
  set
    updated_at = now(),
    title = case
      when title = '새 대화' and new.role = 'user' then left(new.content, 40)
      else title
    end
  where id = new.conversation_id
    and user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row
  execute procedure public.touch_conversation();

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(4096),
  match_count integer default 4,
  match_threshold double precision default 0.3
)
returns table (
  id uuid,
  source text,
  page integer,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    document_chunks.id,
    document_chunks.source,
    document_chunks.page,
    document_chunks.content,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from public.document_chunks
  where 1 - (document_chunks.embedding <=> query_embedding) >= match_threshold
  order by document_chunks.embedding <=> query_embedding
  limit least(match_count, 8);
$$;

revoke all on function public.match_document_chunks(extensions.vector, integer, double precision) from public, anon;
grant execute on function public.match_document_chunks(extensions.vector, integer, double precision) to authenticated, service_role;
