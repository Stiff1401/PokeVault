-- PokéVault – optional Supabase sync backend
-- ---------------------------------------------------------------------------
-- Run this file once in the Supabase SQL editor of a (free-tier) project.
-- Afterwards enter the project URL and the anon key in PokéVault
-- ("Neuen PokéVault starten" -> Supabase, or Settings -> "Familien-Sync").
--
-- Security model
--   * Both tables have row level security enabled and NO policies, so the
--     anon key cannot read or write them directly.
--   * All access goes through the SECURITY DEFINER functions below. Each call
--     must present the vault id plus an access token; the token is
--     sha256("<vaultId>:<PIN>") computed in the browser. Only a hash of the
--     token is stored, so a database leak does not reveal usable tokens.
--   * The editor token grants full read/write, the viewer token grants
--     read access plus setting/clearing gift reservations.

create table if not exists public.pv_vaults (
  id                text primary key,
  name              text not null,
  editor_token_hash text not null,
  viewer_token_hash text not null,
  created_at        timestamptz not null default now()
);

create table if not exists public.pv_items (
  vault_id   text not null references public.pv_vaults (id) on delete cascade,
  kind       text not null check (kind in ('collection', 'targetSets')),
  item_id    text not null,
  data       jsonb,
  -- ISO-8601 client timestamp, used for last-write-wins.
  updated_at text not null,
  deleted    boolean not null default false,
  -- Server receive time, used as the pull cursor.
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (vault_id, kind, item_id)
);

create index if not exists pv_items_cursor on public.pv_items (vault_id, synced_at);

alter table public.pv_vaults enable row level security;
alter table public.pv_items enable row level security;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.pv_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Returns 'editor', 'viewer' or NULL.
create or replace function public.pv_role(p_vault text, p_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when v.editor_token_hash = public.pv_hash(p_token) then 'editor'
           when v.viewer_token_hash = public.pv_hash(p_token) then 'viewer'
         end
    from public.pv_vaults v
   where v.id = p_vault;
$$;

-- ---------------------------------------------------------------------------
-- create vault
-- ---------------------------------------------------------------------------

create or replace function public.pv_create_vault(
  p_vault        text,
  p_name         text,
  p_editor_token text,
  p_viewer_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.pv_vaults%rowtype;
begin
  if p_vault !~ '^[A-Za-z0-9-]{8,64}$'
     or p_editor_token !~ '^[a-f0-9]{64}$'
     or p_viewer_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid vault id or tokens' using errcode = '22023';
  end if;

  select * into v_existing from public.pv_vaults where id = p_vault;
  if found then
    -- Idempotent for the owner, closed for everyone else.
    if v_existing.editor_token_hash = public.pv_hash(p_editor_token) then
      return jsonb_build_object('ok', true, 'created', false);
    end if;
    raise exception 'Vault already exists' using errcode = '23505';
  end if;

  insert into public.pv_vaults (id, name, editor_token_hash, viewer_token_hash)
  values (
    p_vault,
    left(coalesce(nullif(trim(p_name), ''), 'PokéVault'), 80),
    public.pv_hash(p_editor_token),
    public.pv_hash(p_viewer_token)
  );
  return jsonb_build_object('ok', true, 'created', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- pull
-- ---------------------------------------------------------------------------

create or replace function public.pv_pull(p_vault text, p_token text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role    text := public.pv_role(p_vault, p_token);
  v_name    text;
  v_cursor  timestamptz := clock_timestamp() - interval '2 seconds';
  v_changes jsonb;
begin
  if v_role is null then
    raise exception 'Unknown vault or wrong PIN' using errcode = '28000';
  end if;

  select name into v_name from public.pv_vaults where id = p_vault;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'kind', i.kind,
               'id', i.item_id,
               'updatedAt', i.updated_at,
               'deleted', i.deleted,
               'data', case when i.deleted then null else i.data end
             )
           ),
           '[]'::jsonb
         )
    into v_changes
    from public.pv_items i
   where i.vault_id = p_vault
     and i.synced_at > coalesce(p_since, '-infinity'::timestamptz);

  return jsonb_build_object(
    'vaultName', v_name,
    'role', v_role,
    'cursor', to_char(v_cursor at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'changes', v_changes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- push
-- ---------------------------------------------------------------------------

create or replace function public.pv_push(p_vault text, p_token text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     text := public.pv_role(p_vault, p_token);
  v_change   jsonb;
  v_kind     text;
  v_id       text;
  v_updated  text;
  v_deleted  boolean;
  v_data     jsonb;
  v_existing public.pv_items%rowtype;
  v_reserved text;
  v_now      text;
  v_accepted integer := 0;
begin
  if v_role is null then
    raise exception 'Unknown vault or wrong PIN' using errcode = '28000';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 1000 then
    raise exception 'p_changes must be an array of at most 1000 changes' using errcode = '22023';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes)
  loop
    v_kind    := v_change ->> 'kind';
    v_id      := v_change ->> 'id';
    v_updated := v_change ->> 'updatedAt';
    v_deleted := coalesce((v_change ->> 'deleted')::boolean, false);
    v_data    := v_change -> 'data';

    continue when v_kind not in ('collection', 'targetSets');
    continue when v_id is null or length(v_id) = 0 or length(v_id) > 80;
    continue when v_updated is null or v_updated !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$';

    select * into v_existing
      from public.pv_items
     where vault_id = p_vault and kind = v_kind and item_id = v_id;

    if v_role = 'viewer' then
      -- Gift viewers may only set or clear a reservation.
      continue when v_kind <> 'collection' or v_deleted or v_data is null;
      v_reserved := nullif(left(coalesce(v_data ->> 'reservedAsGiftBy', ''), 60), '');
      v_now := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

      if v_existing.item_id is not null then
        continue when v_existing.deleted;
        continue when (v_existing.data ->> 'reservedAsGiftBy') is not distinct from v_reserved;
        if v_now <= v_existing.updated_at then
          v_now := to_char(
            (v_existing.updated_at::timestamptz + interval '1 millisecond') at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          );
        end if;
        update public.pv_items
           set data = v_existing.data
                      || jsonb_build_object('reservedAsGiftBy', v_reserved, 'updatedAt', v_now),
               updated_at = v_now,
               synced_at = clock_timestamp()
         where vault_id = p_vault and kind = v_kind and item_id = v_id;
        v_accepted := v_accepted + 1;
      elsif v_reserved is not null and coalesce(v_data ->> 'cardId', '') <> '' then
        -- Reservation for a card the vault does not own yet: empty placeholder row.
        insert into public.pv_items (vault_id, kind, item_id, data, updated_at, deleted, synced_at)
        values (
          p_vault,
          'collection',
          v_id,
          jsonb_build_object(
            'id', v_id,
            'cardId', left(v_data ->> 'cardId', 80),
            'variant', 'Normal',
            'condition', 'Near Mint',
            'vaultQuantity', 0,
            'tradeQuantity', 0,
            'reservedAsGiftBy', v_reserved,
            'acquiredAt', v_now,
            'updatedAt', v_now
          ),
          v_now,
          false,
          clock_timestamp()
        );
        v_accepted := v_accepted + 1;
      end if;
      continue;
    end if;

    -- Editors: last write wins on the client timestamp.
    continue when v_existing.item_id is not null and v_existing.updated_at >= v_updated;

    if v_deleted then
      continue when v_existing.item_id is null;
      update public.pv_items
         set deleted = true, data = null, updated_at = v_updated, synced_at = clock_timestamp()
       where vault_id = p_vault and kind = v_kind and item_id = v_id;
      v_accepted := v_accepted + 1;
      continue;
    end if;

    continue when v_data is null or jsonb_typeof(v_data) <> 'object';
    continue when pg_column_size(v_data) > 8192;

    insert into public.pv_items (vault_id, kind, item_id, data, updated_at, deleted, synced_at)
    values (p_vault, v_kind, v_id, v_data, v_updated, false, clock_timestamp())
    on conflict (vault_id, kind, item_id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted = false,
          synced_at = excluded.synced_at;
    v_accepted := v_accepted + 1;
  end loop;

  return jsonb_build_object('accepted', v_accepted);
end;
$$;

-- ---------------------------------------------------------------------------
-- grants: only the three entry points are callable with the anon key
-- ---------------------------------------------------------------------------

revoke all on function public.pv_hash(text) from public, anon, authenticated;
revoke all on function public.pv_role(text, text) from public, anon, authenticated;
revoke all on function public.pv_create_vault(text, text, text, text) from public;
revoke all on function public.pv_pull(text, text, timestamptz) from public;
revoke all on function public.pv_push(text, text, jsonb) from public;

grant execute on function public.pv_create_vault(text, text, text, text) to anon, authenticated;
grant execute on function public.pv_pull(text, text, timestamptz) to anon, authenticated;
grant execute on function public.pv_push(text, text, jsonb) to anon, authenticated;
