// BASERA Edge Function: cleanup-locations
//
// Deletes location_points older than 24 hours by calling the
// cleanup_locations() RPC with the service-role key. Schedule it hourly
// (Supabase Dashboard -> Edge Functions -> cleanup-locations -> or any
// external cron) with header:  x-cron-secret: <CRON_SECRET>
// Alternatively enable pg_cron and use 0003_comments_and_cron.sql instead.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected),
//          CRON_SECRET (owner-chosen, set via `supabase secrets set`).
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin.rpc("cleanup_locations");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ deleted: data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
