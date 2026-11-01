-- ROLLBACK for 20261101000000_telemetry_proposal.sql (BASERA Telemetry V7)
--
-- APPLICATION NOTE: the migration was APPLIED TO PRODUCTION
-- 2026-11-01 ~22:41 EET via the dashboard SQL editor under the owner's
-- limited backend-deployment approval. The migration file itself is
-- kept byte-identical to the applied artifact (SHA-256 c7657b18…);
-- this note lives here instead of in the migration header so the
-- applied file stays immutable for CLI reconciliation.
--
-- Prepared and reviewed BEFORE the production deployment (owner GO
-- 2026-11-01). NOT executed. Run ONLY on a real problem that requires
-- full removal of the telemetry backend.
--
-- Scope proof: the deployment creates ONLY the objects dropped below.
-- Dependencies are entirely inside this set:
--   * app_update_events.installation_id -> app_installations (FK)
--   * public.dashboard_* wrappers -> basera_telemetry_private impls
--   * basera_telemetry_private.is_dashboard_owner() -> dashboard_owners
-- No Guardian object references any telemetry object (Guardian predates
-- telemetry; verified in the preflight catalog inventory). The final
-- DROP SCHEMA uses RESTRICT so it FAILS LOUDLY instead of cascading if
-- anything unexpected ever lands in the schema.
--
-- Before running: verify with the production after-check queries that
-- no non-telemetry object depends on these names (pg_depend), and take
-- a data snapshot of the three telemetry tables if they hold real rows.

begin;

-- Public dashboard wrappers first (they depend on the private impls).
drop function if exists public.dashboard_installations(text, text, text, integer, integer);
drop function if exists public.dashboard_adoption();
drop function if exists public.dashboard_overview();

-- Private dashboard implementations + owner gate.
drop function if exists basera_telemetry_private.dashboard_installations(text, text, text, integer, integer);
drop function if exists basera_telemetry_private.dashboard_adoption();
drop function if exists basera_telemetry_private.dashboard_overview();
drop function if exists basera_telemetry_private.is_dashboard_owner();

-- Ingest path (exact deployed signatures).
drop function if exists public.telemetry_ingest(uuid, text, text, text, text, integer, text, text, text, boolean, jsonb, integer);
drop function if exists public.telemetry_bootstrap(text, text, text, integer, text, text, text, boolean);

-- Tables: events first (FK to installations), then the rest.
-- Indexes on these tables drop automatically with them.
drop table if exists public.app_update_events;
drop table if exists public.app_installations;
drop table if exists public.dashboard_owners;

-- Schema last, RESTRICT: fails if anything unexpected remains inside.
drop schema if exists basera_telemetry_private restrict;

commit;
