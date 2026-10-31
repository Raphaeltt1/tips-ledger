"""Non-destructive production security smoke test for the delete-employee Edge Function.

This test uses ONLY unauthenticated requests. It must never use a valid user
session or a real employee ID; deletion can never occur during this test.
"""
import json
import urllib.error
import urllib.request
import unittest

URL = "https://qvwgmybocjyhldwnrqqt.supabase.co/functions/v1/delete-employee"
PUBLIC_KEY = "sb_publishable_QfqtXc7KTnV3SAy2vQ6qIA_3N9cbSd8"
BODY = json.dumps({
    "runner_id": "00000000-0000-0000-0000-000000000000",
    "confirm_name": "Nonexistent smoke test",
}).encode("utf-8")


def denied(extra_headers=None):
    headers = {
        "apikey": PUBLIC_KEY,
        "Content-Type": "application/json",
        "Origin": "https://raphaeltt1.github.io",
    }
    headers.update(extra_headers or {})
    req = urllib.request.Request(URL, data=BODY, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read(1000).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(1000).decode("utf-8", errors="replace")


class DeleteAuthSmokeTests(unittest.TestCase):
    def test_missing_session_rejected_by_function(self):
        status, body = denied()
        self.assertEqual(status, 401)
        self.assertIn('"error":"Unauthorized"', body)

    def test_invalid_session_rejected_by_auth(self):
        status, body = denied({"Authorization": "Bearer invalid.smoke.token"})
        self.assertEqual(status, 401)
        self.assertIn('"error":"Invalid session"', body)


if __name__ == "__main__":
    unittest.main()
