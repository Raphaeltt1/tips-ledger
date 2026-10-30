
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://raphaeltt1.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !anonKey || !serviceKey) {
    return json({ error: "Server is not configured" }, 503);
  }

  try {
    const token = authorization.slice("Bearer ".length);

    const admin = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const authClient = createClient(url, anonKey, {
      global: {
        headers: { Authorization: authorization },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } =
      await authClient.auth.getUser(token);

    if (authError || !authData.user) {
      return json({ error: "Invalid session" }, 401);
    }

    const { data: actor, error: actorError } = await admin
      .from("profiles")
      .select("id,full_name,role,active")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (
      actorError ||
      !actor?.active ||
      !["admin", "superuser"].includes(actor.role)
    ) {
      return json(
        { error: "Admin or Superuser access required" },
        403
      );
    }

    const body = await req.json();
    const runnerId = body?.runner_id;
    const confirmation = body?.confirm_name;

    if (
      typeof runnerId !== "string" ||
      typeof confirmation !== "string"
    ) {
      return json(
        { error: "Employee ID and name confirmation are required" },
        400
      );
    }

    if (runnerId === authData.user.id) {
      return json(
        { error: "You cannot delete your own account here" },
        400
      );
    }

    const { data: runner, error: runnerError } = await admin
      .from("profiles")
      .select("id,full_name,role")
      .eq("id", runnerId)
      .maybeSingle();

    const allowedTargets = actor.role === "superuser"
      ? ["admin", "manager", "runner"]
      : ["manager", "runner"];
    if (
      runnerError ||
      !runner ||
      !allowedTargets.includes(runner.role)
    ) {
      return json({ error: "Employee not found or your role cannot delete this employee" }, 403);
    }

    if (runner.full_name.trim() !== confirmation.trim()) {
      return json(
        {
          error:
            "Name confirmation did not match. Nothing was deleted.",
        },
        400
      );
    }

    // Cleanup runs with the authenticated user's permissions.
    const { error: cleanupError } = await authClient.rpc(
      "admin_permanently_delete_employee",
      { p_employee_id: runnerId }
    );

    if (cleanupError) {
      console.error(
        "Employee cleanup failed:",
        cleanupError.message
      );

      return json(
        {
          error:
            "Could not delete employee history. No account deletion was attempted.",
        },
        500
      );
    }

    // Delete login after successful database cleanup.
    const { error: deleteAuthError } =
      await admin.auth.admin.deleteUser(runnerId);

    if (deleteAuthError) {
      console.error(
        "Auth user deletion failed:",
        deleteAuthError.message
      );

      return json(
        {
          error:
            "Employee history was removed, but the login account could not be deleted. Contact the system administrator before retrying.",
          historyRemoved: true,
        },
        500
      );
    }

    // Keep the actor and target identified in the Audit Log after Auth removal.
    const { error: auditError } = await admin.from("audit_log").insert({
      actor_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action: "employee.permanently_deleted",
      entity_type: "profiles",
      entity_id: runnerId,
      target_user_id: runnerId,
      target_name: runner.full_name,
      details: { deleted_role: runner.role, permanent: true },
    });
    if (auditError) {
      console.error("Permanent deletion succeeded but audit attribution failed:", auditError.message);
    }

    return json({
      success: true,
      message: "Employee account and related history permanently deleted.",
      auditRecorded: !auditError,
    });
  } catch (error) {
    console.error("delete-employee failed:", error);

    return json(
      { error: "Permanent deletion failed." },
      500
    );
  }
});
