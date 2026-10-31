#!/usr/bin/env python3
"""Read-only offsite backup recovery rehearsal.

Reads latest encrypted R2 object, validates the entire archive and restores
representative payment tables to a disposable, network-isolated PostgreSQL 17
Docker container. Never connects to or writes to live Supabase.
All files and the container are destroyed at the end of this job.
"""
import io
import json
import os
import re
import subprocess
import tarfile
import tempfile
import time
import uuid
from pathlib import Path

from daily_offsite_backup import (
    DOCKER_IMAGE, PREFIX, PROJECT_REF, decrypt_archive, digest,
    get_objects, r2_client, required_env, safe_name,
)

MAX_REHEARSAL_BYTES = 1_000_000_000
RESTORE_TABLES = ("runner_rates", "weekly_tips", "receipt_confirmations")


def checked(cmd, step, timeout=120):
    """Never print failed command output: the archive contains private payroll."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{step}: timed out") from None
    if result.returncode != 0:
        # A pre-data error cannot include payroll rows; retain only the
        # PostgreSQL ERROR summary to diagnose missing schema dependencies.
        detail = ""
        if "(pre-data)" in step:
            # Only DDL pre-data restores are diagnosed; never log data restores.
            detail = " — " + result.stderr.strip().replace("\\n", " ")[:600]
        raise RuntimeError(f"{step}: failed (exit {result.returncode}){detail}; "
                           "check the isolated restore script") from None
    return result.stdout.strip()


def fetch_latest(scratch):
    client = r2_client()
    bucket = required_env("R2_BUCKET")
    objects = [obj for obj in get_objects(client, bucket)
               if obj["Key"].endswith(".tlbak")]
    if not objects:
        raise RuntimeError("No encrypted offsite backup is present in R2")
    selected = max(objects, key=lambda obj: obj["LastModified"])
    if selected["Size"] > MAX_REHEARSAL_BYTES:
        raise RuntimeError("Backup exceeds the rehearsal's 1 GB safe memory limit")
    response = client.get_object(Bucket=bucket, Key=selected["Key"])
    cipher = response["Body"].read(MAX_REHEARSAL_BYTES + 1)
    if len(cipher) > MAX_REHEARSAL_BYTES:
        raise RuntimeError("Downloaded backup exceeds safe memory limit")
    plain = decrypt_archive(cipher, required_env("BACKUP_ENCRYPTION_PASSPHRASE"))
    print("Recovered and authenticated the latest R2 backup (read-only).")
    return plain


def verify_and_stage(archive, scratch):
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        members = tar.getmembers()
        names = [m.name for m in members]
        if len(names) != len(set(names)):
            raise RuntimeError("Backup archive has duplicate paths")
        for member in members:
            safe_name(member.name)
            if not (member.isfile() or member.isdir()):
                raise RuntimeError("Backup archive contains an unexpected member type")
        if "manifest.json" not in names or "database.dump" not in names:
            raise RuntimeError("Backup archive is missing required files")
        manifest = json.load(tar.extractfile("manifest.json"))
        if manifest.get("project_ref") != PROJECT_REF:
            raise RuntimeError("Backup belongs to a different project")
        if not set(("public", "auth", "storage")).issubset(set(manifest.get("schema_scope", []))):
            raise RuntimeError("Backup omitted a required schema")
        dump_info = manifest["database_dump"]
        dump = tar.extractfile("database.dump").read()
        if len(dump) != dump_info["bytes"] or digest(dump) != dump_info["sha256"]:
            raise RuntimeError("Database dump checksum or length mismatch")
        for entry in manifest.get("storage_objects", []):
            name = f"storage-files/{safe_name(entry['bucket'])}/{safe_name(entry['name'])}"
            source = tar.extractfile(name)
            if source is None:
                raise RuntimeError("A Storage object is missing from the archive")
            contents = source.read()
            if len(contents) != entry["bytes"] or digest(contents) != entry["sha256"]:
                raise RuntimeError("Storage object checksum or length mismatch")
        (scratch / "database.dump").write_bytes(dump)
        print(f"Validated database dump and {len(manifest.get('storage_objects', []))} Storage file checksums.")
    return scratch / "database.dump"


def smoke_restore(scratch):
    container = "tl-restore-" + uuid.uuid4().hex[:12]
    launched = False
    try:
        checked([
            "docker", "run", "--detach", "--rm", "--network", "none",
            "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
            "-v", f"{scratch}:/work:ro", DOCKER_IMAGE,
        ], "Start disposable isolated PostgreSQL", timeout=180)
        launched = True
        for _ in range(55):
            check = subprocess.run([
                "docker", "exec", container, "pg_isready", "-U", "postgres"
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            if check.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable PostgreSQL did not become ready")

        entries = checked(["docker", "exec", container, "pg_restore",
                           "--list", "/work/database.dump"],
                          "Validate PostgreSQL custom-format archive")
        for table in RESTORE_TABLES:
            if not any((" TABLE DATA " in line or " TABLE " in line)
                       and " public " in line and
                       f" {table} " in (line + " ") for line in entries.splitlines()):
                raise RuntimeError(f"Archive is missing required payment table {table}")
            for section in ("pre-data", "data"):
                checked([
                    "docker", "exec", container, "pg_restore", "--exit-on-error",
                    "--no-owner", "--no-privileges", f"--section={section}",
                    "--schema=public", f"--table={table}",
                    "--dbname=postgres", "/work/database.dump",
                ], f"Isolated restore of {table} ({section})", timeout=120)

        counts = {}
        for table in RESTORE_TABLES:
            count = checked([
                "docker", "exec", container, "psql", "--no-psqlrc",
                "-U", "postgres", "-d", "postgres", "-At",
                "-v", "ON_ERROR_STOP=1",
                "-c", f"SELECT COUNT(*) FROM public.{table};",
            ], f"Verify restored {table}")
            counts[table] = int(count)
        if counts["weekly_tips"] == 0:
            raise RuntimeError("Restored weekly_tips table is unexpectedly empty")
        print(f"SUCCESS: isolated payment table restore passed; "
              f"{counts['weekly_tips']} weekly payments, "
              f"{counts['receipt_confirmations']} confirmations, "
              f"{counts['runner_rates']} employee rates.")
        print("Live Supabase was never contacted or modified. Test database will be discarded.")
    finally:
        if launched:
            subprocess.run(["docker", "rm", "--force", container],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=40, check=False)


def main():
    with tempfile.TemporaryDirectory(prefix="tl-restore-check-") as tmp:
        scratch = Path(tmp)
        encrypted_tar = fetch_latest(scratch)
        verify_and_stage(encrypted_tar, scratch)
        smoke_restore(scratch)


if __name__ == "__main__":
    main()
