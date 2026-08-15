from __future__ import annotations

import os
import re
import secrets
import socket
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from app.publisher import hash_publisher_key


def replace_env_values(path: Path, values: dict[str, str]) -> None:
    lines = path.read_text().splitlines() if path.exists() else []
    remaining = dict(values)
    updated: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line else ""
        if key in remaining:
            updated.append(f"{key}={remaining.pop(key)}")
        else:
            updated.append(line)
    if remaining and updated and updated[-1]:
        updated.append("")
    updated.extend(f"{key}={value}" for key, value in remaining.items())
    path.write_text("\n".join(updated) + "\n")


def main() -> None:
    env_path = Path(".env")
    load_dotenv(env_path)
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    host = re.sub(r"[^a-z0-9-]+", "-", socket.gethostname().lower()).strip("-")
    device_id = f"scraper-{host}"[:100]
    key = secrets.token_urlsafe(32)
    salt = secrets.token_bytes(16)
    key_hash = hash_publisher_key(key, salt)
    with psycopg.connect(database_url, prepare_threshold=None) as connection:
        connection.execute(
            """
            insert into public.publisher_devices
              (id, display_name, key_salt, key_hash, revoked_at)
            values (%s, %s, %s, %s, null)
            on conflict (id) do update set
              display_name = excluded.display_name,
              key_salt = excluded.key_salt,
              key_hash = excluded.key_hash,
              revoked_at = null
            """,
            (device_id, f"Scraper {socket.gethostname()}", salt, key_hash),
        )
    replace_env_values(
        env_path,
        {
            "PUBLISH_API_URL": "https://biddesk-cc-api.vercel.app",
            "PUBLISH_DEVICE_ID": device_id,
            "PUBLISH_API_KEY": key,
        },
    )
    print(f"Registered publisher device: {device_id}")


if __name__ == "__main__":
    main()
