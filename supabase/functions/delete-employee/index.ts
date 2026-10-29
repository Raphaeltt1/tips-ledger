import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://raphaeltt1.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server is not configured" }, 503);

  try {
    const token = authorization.slice("Bearer ".length);
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const { data: actor, error: actorError } = await admin
      .from("profiles").select("id,role,active")
      .eq("id", authData.user.id).maybeSingle();
    if (actorError || !actor?.active || actor.role !== "admin") {
      return json({ error: "Admin access required" }, 403);
    }

    const body = await req.json();
    const runnerId = body?.runner_id;
    const confirmation = body?.confirm_name;
    if (typeof runnerId !== "string" || typeof confirmation !== "string") {
      return json({ error: "Runner ID and name confirmation are required" }, 400);
    }
    if (runnerId === authData.user.id) return json({ error: "You cannot delete your own account here" }, 400);

    const { data: runner, error: runnerError } = await admin
      .from("profiles").select("id,full_name,role")
      .eq("id", runnerId).maybeSingle();
    if (runnerError || !runner || runner.role !== "runner") {
      return json({ error: "Runner not found" }, 404);
    }
    if (runner.full_name.trim() !== confirmation.trim()) {
      return json({ error: "Name confirmation did not match. Nothing was deleted." }, 400);
    }

    // Remove payout history and related records through the admin-only database function.
    const { error: cleanupError } = await authClient.rpc(
      "admin_permanently_delete_runner",
      { p_runner_id: runnerId },
    );
    if (cleanupError) {
      console.error("Runner cleanup failed:", cleanupError.message);
      return json({ error: "Could not delete runner history. No account deletion was attempted." }, 500);
    }

    // Delete the actual Supabase Auth login; its linked profile is expected to cascade.
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(runnerId);
    if (deleteAuthError) {
      console.error("Auth user deletion failed:", deleteAuthError.message);
      return json({
        error: "Runner history was removed, but the login account could not be deleted. Contact the system administrator before retrying.",
        historyRemoved: true,
      }, 500);
    }

    return json({ success: true, message: "Runner account and related history permanently deleted." });
  } catch (error) {
    console.error("delete-employee failed:", error);
    return json({ error: "Permanent deletion failed." }, 500);
  }
});
