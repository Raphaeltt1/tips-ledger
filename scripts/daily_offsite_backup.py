#!/usr/bin/env python3
"""Encrypted, offsite, read-only backup of Supabase PostgreSQL and Storage files.

Runs only in GitHub Actions with explicitly configured repository secrets.
NEVER add credentials or generated backups to the public repository.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.config import Config
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

PROJECT_REF = "qvwgmybocjyhldwnrqqt"
PREFIX = "tips-ledger/daily/"
RETENTION_DAYS = 30
SAFE_MAX_BYTES = 8_000_000_000  # Stop before Cloudflare R2's 10 GB-month free allowance.
DOCKER_IMAGE = "postgres:17.6-bookworm"
ARCHIVE_MAGIC = b"TLB1"
AAD = b"tips-ledger-offsite-backup-v1"


def required_env(name):
    value = os.environ.get(name, "")
    if not value.strip():
        raise RuntimeError(f"Required GitHub repository secret/variable is missing: {name}")
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def db_client_command(scratch, command):
    # Pass the connection string as a Docker environment variable rather than
    # shell-interpolating it; do not log the database URL or process environment.
    return [
        "docker", "run", "--rm", "--network", "host",
        "-v", f"{scratch}:/work", "-w", "/work",
        "-e", "SUPABASE_DB_URL", DOCKER_IMAGE,
        *command,
    ]


def run_database_export(scratch):
    print("Exporting PostgreSQL schemas public, auth, and storage (read-only)...")
    subprocess.run(db_client_command(scratch, [
        "pg_dump", "--dbname", os.environ["SUPABASE_DB_URL"],
        "--format=custom", "--compress=6",
        "--no-owner", "--no-privileges",
        "--schema=public", "--schema=auth", "--schema=storage",
        "--file=/work/database.dump",
    ]), check=True, timeout=900)
    dump = scratch / "database.dump"
    if not dump.exists() or dump.stat().st_size < 100:
        raise RuntimeError("Database dump was missing or empty")

    query = (
        "SELECT COALESCE(json_agg(json_build_object("
        "'bucket',o.bucket_id,'name',o.name,'is_public',b.public"
        ") ORDER BY o.bucket_id,o.name),'[]'::json)::text "
        "FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id "
        "WHERE o.name IS NOT NULL;"
    )
    result = subprocess.run(db_client_command(scratch, [
        "psql", "--dbname", os.environ["SUPABASE_DB_URL"],
        "--no-psqlrc", "--tuples-only", "--no-align",
        "--set", "ON_ERROR_STOP=1", "--command", query,
    ]), check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, timeout=120)
    return dump, json.loads(result.stdout.strip())


def safe_name(value):
    # Ensure files cannot escape the backup directory or overwrite metadata.
    name = str(value)
    parts = name.split("/")
    if not name or name.startswith("/") or "\\" in name or any(p in ("", ".", "..") for p in parts):
        raise RuntimeError("Invalid Storage object path; backup aborted")
    return name


def download_storage_files(scratch, objects):
    storage_root = scratch / "storage-files"
    storage_root.mkdir()
    manifest = []
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    for row in objects:
        bucket = safe_name(row["bucket"])
        name = safe_name(row["name"])
        public = bool(row["is_public"])
        if not public and not service_key:
            raise RuntimeError(
                "A private Storage bucket exists. Add SUPABASE_SERVICE_ROLE_KEY "
                "as a GitHub Actions secret to back up private files."
            )
        encoded = "/".join(urllib.parse.quote(p, safe="") for p in (bucket + "/" + name).split("/"))
        if public:
            url = f"https://{PROJECT_REF}.supabase.co/storage/v1/object/public/{encoded}"
            headers = {}
        else:
            url = f"https://{PROJECT_REF}.supabase.co/storage/v1/object/authenticated/{encoded}"
            headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}
        target = storage_root / bucket / name
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45) as response:
                if response.status != 200:
                    raise RuntimeError("Storage download did not return HTTP 200")
                data = response.read(20_000_001)
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"Storage download failed (HTTP {err.code})") from None
        if len(data) > 20_000_000:
            raise RuntimeError("Storage object exceeds 20 MB safety limit; review backup script")
        target.write_bytes(data)
        manifest.append({
            "bucket": bucket, "name": name, "bytes": len(data),
            "sha256": digest(data), "public": public,
        })
    print(f"Exported {len(manifest)} Storage files.")
    return manifest


def encrypt_archive(cleartext, passphrase):
    # AES-256-GCM authenticates and encrypts all contents; salt and nonce are
    # random per backup. Keep the passphrase OUTSIDE Supabase/R2 and off logs.
    salt = os.urandom(16)
    nonce = os.urandom(12)
    kdf = Scrypt(salt=salt, length=32, n=2**15, r=8, p=1)
    key = kdf.derive(passphrase.encode("utf-8"))
    return ARCHIVE_MAGIC + salt + nonce + AESGCM(key).encrypt(nonce, cleartext, AAD)


def decrypt_archive(encrypted, passphrase):
    if not encrypted.startswith(ARCHIVE_MAGIC) or len(encrypted) < 48:
        raise ValueError("Unknown or damaged backup archive")
    salt, nonce, ciphertext = encrypted[4:20], encrypted[20:32], encrypted[32:]
    kdf = Scrypt(salt=salt, length=32, n=2**15, r=8, p=1)
    key = kdf.derive(passphrase.encode("utf-8"))
    return AESGCM(key).decrypt(nonce, ciphertext, AAD)


def create_archive(scratch, dump, storage_manifest, timestamp):
    manifest = {
        "format": 1,
        "created_utc": timestamp.isoformat(),
        "postgres_version": "17",
        "project_ref": PROJECT_REF,
        "git_sha": os.getenv("GITHUB_SHA", ""),
        "schema_scope": ["public", "auth", "storage"],
        "database_dump": {
            "name": "database.dump",
            "bytes": dump.stat().st_size,
            "sha256": digest(dump.read_bytes()),
        },
        "storage_objects": storage_manifest,
        "notes": "Does not export Auth/Edge Function dashboard settings or private server secrets.",
    }
    (scratch / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    archive_file = scratch / "backup.tar.gz"
    with tarfile.open(archive_file, "w:gz") as tar:
        tar.add(scratch / "manifest.json", arcname="manifest.json")
        tar.add(dump, arcname="database.dump")
        if storage_manifest:
            tar.add(scratch / "storage-files", arcname="storage-files")
    return archive_file.read_bytes()


def r2_client():
    return boto3.client(
        "s3", endpoint_url=required_env("R2_ENDPOINT"),
        region_name="auto",
        aws_access_key_id=required_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=required_env("R2_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    )


def get_objects(s3, bucket):
    items = []
    token = None
    while True:
        args = {"Bucket": bucket, "Prefix": PREFIX, "MaxKeys": 1000}
        if token:
            args["ContinuationToken"] = token
        response = s3.list_objects_v2(**args)
        items.extend(response.get("Contents", []))
        if not response.get("IsTruncated"):
            return items
        token = response.get("NextContinuationToken")
        if not token:
            raise RuntimeError("R2 listing is incomplete; refusing to delete backups")


def backup():
    url = required_env("SUPABASE_DB_URL")
    if not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("SUPABASE_DB_URL must be a Postgres connection URI")
    passphrase = required_env("BACKUP_ENCRYPTION_PASSPHRASE")
    if len(passphrase) < 20:
        raise RuntimeError("Encryption passphrase must be at least 20 characters")
    if not re.match(r"^https://[A-Za-z0-9.-]+\.r2\.cloudflarestorage\.com/?$", required_env("R2_ENDPOINT")):
        raise RuntimeError("R2_ENDPOINT must be the private Cloudflare R2 S3 endpoint")
    bucket = required_env("R2_BUCKET")
    now = datetime.now(timezone.utc)

    with tempfile.TemporaryDirectory(prefix="tl-backup-") as tmp:
        scratch = Path(tmp)
        dump, storage_objects = run_database_export(scratch)
        downloaded = download_storage_files(scratch, storage_objects)
        plaintext = create_archive(scratch, dump, downloaded, now)
        encrypted = encrypt_archive(plaintext, passphrase)
        # Test the encryption/decryption and archive structure before upload.
        if decrypt_archive(encrypted, passphrase) != plaintext:
            raise RuntimeError("Local encryption verification failed")
        with tarfile.open(fileobj=io.BytesIO(plaintext), mode="r:gz") as tar:
            manifest = json.load(tar.extractfile("manifest.json"))
            if manifest["database_dump"]["sha256"] != digest(tar.extractfile("database.dump").read()):
                raise RuntimeError("Database checksum failed before upload")

        s3 = r2_client()
        existing = get_objects(s3, bucket)
        current_bytes = sum(x.get("Size", 0) for x in existing)
        if current_bytes + len(encrypted) > SAFE_MAX_BYTES:
            raise RuntimeError(
                "R2 safety threshold reached (8 GB); refusing upload to avoid unexpected storage charges"
            )
        key = f"{PREFIX}{now:%Y-%m-%dT%H-%M-%SZ}.tlbak"
        s3.put_object(
            Bucket=bucket, Key=key, Body=encrypted,
            ContentType="application/octet-stream",
            Metadata={"backup-sha256": digest(encrypted), "format": "tlb1"},
        )
        # Verify a full R2 download, including AES-GCM authentication.
        response = s3.get_object(Bucket=bucket, Key=key)
        downloaded_encrypted = response["Body"].read()
        if digest(downloaded_encrypted) != digest(encrypted):
            raise RuntimeError("R2 downloaded bytes do not match uploaded backup")
        if decrypt_archive(downloaded_encrypted, passphrase) != plaintext:
            raise RuntimeError("R2 backup cannot be decrypted and verified")

        cutoff = now - timedelta(days=RETENTION_DAYS)
        old = [x["Key"] for x in existing if x["LastModified"] < cutoff and x["Key"].endswith(".tlbak")]
        # Only prune after a successful, verified new backup.
        for i in range(0, len(old), 1000):
            s3.delete_objects(
                Bucket=bucket,
                Delete={"Objects": [{"Key": key} for key in old[i:i + 1000]], "Quiet": True},
            )
        print(f"SUCCESS: encrypted and verified R2 backup; {len(downloaded)} Storage files; "
              f"{len(encrypted)} encrypted bytes; removed {len(old)} expired copies.")
        print(f"R2 object: {key}")
        print("Keep BACKUP_ENCRYPTION_PASSPHRASE safe outside GitHub; without it the backup cannot be restored.")


if __name__ == "__main__":
    backup()
