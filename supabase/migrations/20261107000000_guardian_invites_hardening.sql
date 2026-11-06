-- Guardian invite hardening — ADDITIVE, IDEMPOTENT, NOT APPLIED.
--
-- Supports the email-bound invite functions in
-- supabase/functions/{create,accept}-guardian-invite/ (hardened
-- replacements for the deployed bearer-code functions). Applying
-- this file is a PRODUCTION CHANGE: it requires the project owner's
-- explicit authorization and the preflight in
-- docs/INVITE_HARDENING_DEPLOY.md. Do not apply it as part of any
-- other release step.
--
-- What it does:
-- * Ensures the private.guardian_invites table exists with the
--   columns the hardened functions rely on (no drops, no renames,
--   no data rewrites; existing columns/rows are untouched).
-- * Stores codes ONLY as SHA-256 hashes (code_hash, unique).
-- * Adds invited_email (recipient binding), used_at/used_by
--   (single-use claim), expires_at (15-minute TTL).
-- * RLS stays enabled with no client policies: the table is
--   reachable only by the service role from Edge Functions.
--
-- Rollback: the hardened functions can be replaced by the previous
-- deployed versions at any time; this migration is additive, so no
-- rollback SQL is required for safety (dropping the added columns
-- is possible but unnecessary and is NOT part of the rollback).

create schema if not exists private;

create table if not exists private.guardian_invites (
  id uuid primary key default gen_random_uuid(),
  wearer_user_id uuid not null,
  invited_email text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid
);

alter table private.guardian_invites
  add column if not exists wearer_user_id uuid,
  add column if not exists invited_email text,
  add column if not exists code_hash text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists used_at timestamptz,
  add column if not exists used_by uuid;

create unique index if not exists guardian_invites_code_hash_key
  on private.guardian_invites (code_hash);

create index if not exists guardian_invites_wearer_created_idx
  on private.guardian_invites (wearer_user_id, created_at desc);

alter table private.guardian_invites enable row level security;

-- No policies are created: anon/authenticated have no access at all.
revoke all on private.guardian_invites from anon, authenticated;
