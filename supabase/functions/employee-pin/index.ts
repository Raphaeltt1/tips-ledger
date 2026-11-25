import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "https://raphaeltt1.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const { action, email, pin } = await req.json();
    if (typeof pin !== "string" || !/^[0-9]{4}$/.test(pin)) return reply({error:"Enter exactly four digits."}, 400);
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_ANON_KEY")!;
    const options = {auth:{persistSession:false, autoRefreshToken:false}};
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);
    const auth = createClient(url, key, options).auth;
    const denied = () => reply({error:"Sign-in unsuccessful. Check your details or use the reset link."}, 401);
    async function credential(account: string) {
      const {data,error} = await admin.rpc("ledger_pin_credential", {account_email:account,account_pin:pin});
      if (error || !data) throw Error("PIN service unavailable");
      return data;
    }

    if (action === "login") {
      if (typeof email !== "string" || email.length > 320) return denied();
      const account = email.trim().toLowerCase();
      const {data:allowed,error} = await admin.rpc("ledger_pin_attempt",{account_email:account});
      if (error) throw error;
      if (!allowed) return denied();
      const {data,error:invalid} = await auth.signInWithPassword({email:account,password:await credential(account)});
      if (invalid || !data.session) return denied();
      await admin.rpc("ledger_pin_clear",{account_id:data.user.id});
      return reply({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
    }

    if (action === "set") {
      const authorization = req.headers.get("Authorization") || "";
      const {data,error} = await auth.getUser(authorization.replace(/^Bearer /i,""));
      if (error || !data.user?.email) return denied();
      // Keep the caller's Auth recovery, reauthentication and MFA policy in force.
      const result = await fetch(url + "/auth/v1/user", {
        method:"PUT", headers:{authorization,apikey:key,"Content-Type":"application/json"},
        body:JSON.stringify({password:await credential(data.user.email)})
      });
      if (!result.ok) return reply({error:"Could not set PIN. Sign in again or request a fresh reset link."}, 400);
      await admin.rpc("ledger_pin_clear",{account_id:data.user.id});
      return reply({success:true});
    }
    return reply({error:"Unknown action"},400);
  } catch {
    return reply({error:"PIN service unavailable. Try again later."},503);
  }
});
