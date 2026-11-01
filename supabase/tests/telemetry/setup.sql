-- Local harness ONLY: emulate the Supabase role/auth surface on a
-- vanilla PostgreSQL 16 so the migration can be tested as-is.
-- (auth.uid() mirrors Supabase's implementation: it reads the `sub`
-- claim from the request.jwt.claims GUC set by the API layer.)
-- Idempotent: safe to run before every battery run.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
