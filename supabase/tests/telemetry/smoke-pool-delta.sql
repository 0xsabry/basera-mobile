-- SMOKE-ONLY delta (test project basera-telemetry-smoke): replaces
-- the v5 telemetry_ingest (11 params) with the v7 sized-pool version
-- (12 params, p_pool_request). Generated from
-- 20261101000000_telemetry_proposal.sql — never run on production
-- (production has no telemetry_ingest at all; the full migration
-- applies there if and when the owner approves it).
drop function if exists public.telemetry_ingest(uuid, text, text, text, text, integer, text, text, text, boolean, jsonb);

create or replace function public.telemetry_ingest(
  p_installation_id uuid,
  p_secret_hash text,
  p_platform text,
  p_os_version text,
  p_app_version text,
  p_version_code integer,
  p_runtime_version text,
  p_channel text,
  p_current_update_id text,
  p_is_embedded_launch boolean,
  p_events jsonb,
  -- Event-id pool economics: ids are granted ONLY against an
  -- explicit, sized client request (the client asks when its local
  -- pool runs low). The grant is clamped to [0, 100] here no matter
  -- what was requested; a heartbeat that asks for nothing gets
  -- nothing, so repeated heartbeats cannot grow the client's pool.
  p_pool_request integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.app_installations%rowtype;
  v_pool_grant integer := least(greatest(coalesce(p_pool_request, 0), 0), 100);
  v_found boolean := false;
  v_recent bigint;
  v_accepted jsonb := '[]'::jsonb;
  v_duplicates jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_ev jsonb;
  v_cid text;
  v_cid_uuid uuid;
  v_type text;
  v_uid text;
  v_status text;
  v_reason text;
  v_ts text;
  v_ts_parsed timestamptz;
  v_err text;
  v_field text;
  v_budget bigint := 600;
  v_new_count integer := 0;
begin
  if p_installation_id is null or p_secret_hash is null or length(p_secret_hash) <> 64 then
    return pg_catalog.jsonb_build_object('error', 'invalid_installation_credentials');
  end if;

  -- Strict envelope: events must be present, a JSON array, and hold
  -- at most 50 entries. Anything else fails the WHOLE request before
  -- any write (defense in depth behind the Edge Function's checks).
  if p_events is null or pg_catalog.jsonb_typeof(p_events) <> 'array' then
    return pg_catalog.jsonb_build_object('error', 'invalid_events');
  end if;
  if pg_catalog.jsonb_array_length(p_events) > 50 then
    return pg_catalog.jsonb_build_object('error', 'batch_too_large');
  end if;

  -- Serialize everything for this installation: secret verification
  -- and the hourly budget are race-free under this lock.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 0));

  select * into v_inst from public.app_installations i where i.id = p_installation_id;
  v_found := found;

  if not v_found then
    -- Installations are created ONLY by telemetry_bootstrap (server
    -- CSPRNG). An unknown id here was never issued: refuse it. No
    -- row is created and no heartbeat is recorded.
    return pg_catalog.jsonb_build_object('error', 'unknown_installation');
  elsif v_inst.secret_hash <> p_secret_hash then
    return pg_catalog.jsonb_build_object('error', 'secret_mismatch');
  end if;

  -- Events received in the trailing hour (budget base). Duplicates
  -- and invalid events below never add to this count.
  select count(*) into v_recent
  from public.app_update_events e
  where e.installation_id = p_installation_id
    and e.received_at > now() - interval '1 hour';

  for v_ev in select value from pg_catalog.jsonb_array_elements(p_events)
  loop
    v_err := null;
    v_field := null;

    if pg_catalog.jsonb_typeof(v_ev) <> 'object' then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object(
        'client_event_id', null, 'reason', 'invalid_event_shape');
      continue;
    end if;

    -- Strict JSON types per field: a present field must be a JSON
    -- string (or null). Numbers/booleans/objects are rejected with
    -- the field named — never silently coerced through ->>.
    foreach v_field in array array['client_event_id', 'event_type', 'update_id', 'status', 'failure_reason', 'client_ts']
    loop
      if v_ev ? v_field
         and pg_catalog.jsonb_typeof(v_ev -> v_field) not in ('string', 'null') then
        v_err := 'invalid_field_type';
        exit;
      end if;
    end loop;
    if v_err is null then
      v_field := null; -- only report a field when it is the offender
    end if;

    if v_err is null then
      v_cid := v_ev ->> 'client_event_id';
      v_type := v_ev ->> 'event_type';
      v_uid := v_ev ->> 'update_id';
      v_status := coalesce(v_ev ->> 'status', 'ok');
      v_reason := v_ev ->> 'failure_reason';
      v_ts := v_ev ->> 'client_ts';
      v_cid_uuid := null;
      v_ts_parsed := null;

      if v_cid is null then
        v_err := 'missing_client_event_id';
      else
        begin
          v_cid_uuid := v_cid::uuid;
        exception when others then
          v_err := 'invalid_client_event_id';
        end;
      end if;
      if v_err is null and (v_type is null or v_type not in
          ('update_check', 'update_available', 'update_downloaded', 'update_applied', 'update_failed')) then
        v_err := 'invalid_event_type';
      end if;
      if v_err is null and v_uid is not null
         and v_uid <> 'rollback-to-embedded'
         and v_uid !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        v_err := 'invalid_update_id';
      end if;
      if v_err is null and v_status not in ('ok', 'failed') then
        v_err := 'invalid_status';
      end if;
      if v_err is null and v_reason is not null and length(v_reason) > 300 then
        v_err := 'failure_reason_too_long';
      end if;
      if v_err is null and v_ts is not null then
        begin
          v_ts_parsed := v_ts::timestamptz;
        exception when others then
          v_err := 'invalid_client_ts';
        end;
        if v_err is null and (v_ts_parsed < now() - interval '24 hours'
                              or v_ts_parsed > now() + interval '24 hours') then
          v_err := 'client_ts_out_of_window';
        end if;
      end if;
    end if;

    if v_err is not null then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object(
        'client_event_id', v_ev ->> 'client_event_id',
        'reason', v_err,
        'field', v_field);
      continue;
    end if;

    -- Duplicate? (Already stored — a retry/replay. Never counted
    -- against the budget, never inserted twice.)
    if exists (select 1 from public.app_update_events e where e.client_event_id = v_cid_uuid) then
      v_duplicates := v_duplicates || pg_catalog.to_jsonb(v_cid);
      continue;
    end if;

    -- Atomic budget for genuinely new events.
    if v_recent + v_new_count >= v_budget then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object(
        'client_event_id', v_cid, 'reason', 'rate_limited');
      continue;
    end if;

    insert into public.app_update_events (
      client_event_id, installation_id, event_type, update_id,
      app_version, runtime_version, channel, status, failure_reason, client_ts
    ) values (
      v_cid_uuid, p_installation_id, v_type, v_uid,
      p_app_version, p_runtime_version, p_channel, v_status, v_reason, v_ts_parsed
    );
    v_new_count := v_new_count + 1;
    v_accepted := v_accepted || pg_catalog.to_jsonb(v_cid);
  end loop;

  -- Heartbeat: latest facts + last_seen (also on secret-verified
  -- requests with zero events — but never on a malformed request:
  -- those returned above, before any write).
  update public.app_installations i set
    platform = coalesce(p_platform, i.platform),
    os_version = p_os_version,
    app_version = p_app_version,
    version_code = p_version_code,
    runtime_version = p_runtime_version,
    channel = p_channel,
    current_update_id = p_current_update_id,
    is_embedded_launch = coalesce(p_is_embedded_launch, i.is_embedded_launch),
    last_seen_at = now()
  where i.id = p_installation_id;

  return pg_catalog.jsonb_build_object(
    'accepted', v_accepted,
    'duplicates', v_duplicates,
    'rejected', v_rejected,
    'event_id_pool', (
      select coalesce(pg_catalog.jsonb_agg(g), '[]'::jsonb)
      from (
        select pg_catalog.gen_random_uuid()::text as g
        from pg_catalog.generate_series(1, v_pool_grant)
      ) pool
    )
  );
end;
$$;
revoke execute on function public.telemetry_ingest(uuid, text, text, text, text, integer, text, text, text, boolean, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.telemetry_ingest(uuid, text, text, text, text, integer, text, text, text, boolean, jsonb, integer)
  to service_role;
