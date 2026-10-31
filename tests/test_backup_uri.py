"""Local-only tests: no network, no database queries, no secrets."""
import os
import unittest
from unittest.mock import patch

from scripts.daily_offsite_backup import configure_database_environment


class TestSupabaseConnectionUri(unittest.TestCase):
    def parse(self, uri):
        with patch.dict(os.environ, {"SUPABASE_DB_URL": uri}, clear=False):
            configure_database_environment()
            return {k: os.environ.get(k) for k in (
                "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"
            )}

    def test_standard_supabase_session_pooler(self):
        settings = self.parse(
            "postgresql://postgres.qvwgmybocjyhldwnrqqt:"
            "sample-long-test-value@aws-0-eu-north-1.pooler.supabase.com:5432/postgres"
        )
        self.assertEqual(settings["PGUSER"], "postgres.qvwgmybocjyhldwnrqqt")
        self.assertEqual(settings["PGPORT"], "5432")
        self.assertEqual(settings["PGPASSWORD"], "sample-long-test-value")
        self.assertEqual(settings["PGDATABASE"], "postgres")

    def test_raw_reserved_characters_in_password(self):
        settings = self.parse(
            "postgresql://postgres.qvwgmybocjyhldwnrqqt:"
            "raw[@?/#]value@aws-0-eu-north-1.pooler.supabase.com:5432/postgres"
        )
        self.assertEqual(settings["PGPASSWORD"], "raw[@?/#]value")

    def test_percent_encoded_password(self):
        settings = self.parse(
            "postgresql://postgres.qvwgmybocjyhldwnrqqt:"
            "encoded%40test%23value@aws-0-eu-north-1.pooler.supabase.com:5432/postgres"
        )
        self.assertEqual(settings["PGPASSWORD"], "encoded@test#value")

    def test_password_placeholder_explained(self):
        with self.assertRaisesRegex(RuntimeError, r"still contains \\[YOUR-PASSWORD\\]"):
            self.parse(
                "postgresql://postgres.qvwgmybocjyhldwnrqqt:"
                "[YOUR-PASSWORD]@aws-0-eu-north-1.pooler.supabase.com:5432/postgres"
            )

    def test_transaction_port_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "port 5432"):
            self.parse(
                "postgresql://postgres.qvwgmybocjyhldwnrqqt:"
                "sample@aws-0-eu-north-1.pooler.supabase.com:6543/postgres"
            )

    def test_unrelated_host_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "configured Supabase project"):
            self.parse(
                "postgresql://postgres.any:sample@unrelated.example.com:5432/postgres"
            )


if __name__ == "__main__":
    unittest.main()
