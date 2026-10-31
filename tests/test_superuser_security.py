from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent

class SuperuserSecurityTests(unittest.TestCase):
    def test_mfa_gate_precedes_profile_data(self):
        source = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("auth.mfa.getAuthenticatorAssuranceLevel()", source)
        self.assertIn("auth.mfa.challenge(", source)
        self.assertIn("auth.mfa.verify(", source)
        self.assertIn("auth.mfa.enroll(", source)
        self.assertIn("if(await requireMfa())return", source)
        self.assertLess(source.index("if(await requireMfa())return"), source.index("const r=await db.from('profiles').select("))

    def test_backup_status_is_read_only_and_fail_closed(self):
        source = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("profile?.role!=='superuser'", source)
        self.assertIn("daily-offsite-backup.yml", source)
        self.assertIn("Status unavailable. Do not assume the backup succeeded.", source)
        self.assertNotIn("BACKUP_ENCRYPTION_PASSPHRASE", source)
        self.assertNotIn("R2_SECRET_ACCESS_KEY", source)

    def test_server_privileges_consider_mfa(self):
        migration = (ROOT / "supabase/migrations/20261031_superuser_mfa_enforcement.sql").read_text()
        self.assertIn("auth.mfa_factors", migration)
        self.assertIn("status = 'verified'", migration)
        self.assertIn("= 'aal2'", migration)
        self.assertIn("p.role <> 'superuser'", migration)
        edge = (ROOT / "supabase/functions/create-employee-/index.ts").read_text()
        self.assertIn('await authClient.rpc("current_user_role")', edge)
        self.assertIn("sessionRole !== actor.role", edge)

if __name__ == "__main__":
    unittest.main()
