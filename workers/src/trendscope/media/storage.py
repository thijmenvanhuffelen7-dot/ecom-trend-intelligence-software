"""S3-compatibele opslag (MinIO lokaal, R2/S3 in productie). Content-addressed: sha256 = sleutel."""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from trendscope.core.settings import get_settings

EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
}
MAX_BYTES = 50 * 1024 * 1024


@dataclass(frozen=True)
class StoredAsset:
    sha256: str
    key: str
    content_type: str
    bytes: int
    width: int | None
    height: int | None


@lru_cache(maxsize=1)
def s3_client() -> Any:
    import boto3
    from botocore.config import Config

    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key_id,
        aws_secret_access_key=s.s3_secret_access_key,
        region_name=s.s3_region if s.s3_region != "auto" else "us-east-1",
        config=Config(signature_version="s3v4"),
    )


def ensure_bucket(client: Any | None = None, bucket: str | None = None) -> None:
    client = client or s3_client()
    bucket = bucket or get_settings().s3_bucket
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if bucket not in existing:
        client.create_bucket(Bucket=bucket)


def image_size(data: bytes, content_type: str) -> tuple[int | None, int | None]:
    """Breedte/hoogte uit de header lezen (PNG/JPEG/GIF) zonder beeldbibliotheek."""
    if content_type == "image/png" and data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return int(w), int(h)
    if content_type == "image/gif" and data[:4] == b"GIF8":
        w, h = struct.unpack("<HH", data[6:10])
        return int(w), int(h)
    if content_type == "image/jpeg":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                break
            marker, length = data[i + 1], struct.unpack(">H", data[i + 2 : i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                return int(w), int(h)
            i += 2 + length
    return None, None


def put_asset(data: bytes, content_type: str, *, prefix: str = "creatives", client: Any | None = None) -> StoredAsset:
    if len(data) > MAX_BYTES:
        raise ValueError(f"Bestand te groot ({len(data)} bytes)")
    content_type = content_type.split(";")[0].strip().lower()
    if content_type not in EXTENSIONS:
        raise ValueError(f"Niet-toegestaan type: {content_type}")
    digest = hashlib.sha256(data).hexdigest()
    key = f"{prefix}/{digest[:2]}/{digest}.{EXTENSIONS[content_type]}"
    client = client or s3_client()
    client.put_object(
        Bucket=get_settings().s3_bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )
    w, h = image_size(data, content_type)
    return StoredAsset(digest, key, content_type, len(data), w, h)


def get_asset(key: str, client: Any | None = None) -> tuple[bytes, str]:
    """(bytes, content-type) van een eigen asset; alleen content-addressed sleutels die wij zelf schrijven."""
    import re as _re

    if not _re.fullmatch(r"(creatives|screenshots|products)/[0-9a-f]{2}/[0-9a-f]{64}\.(jpg|png|webp|gif|mp4)", key):
        raise ValueError("Onbekende sleutel")
    obj = (client or s3_client()).get_object(Bucket=get_settings().s3_bucket, Key=key)
    return obj["Body"].read(), str(obj.get("ContentType") or "application/octet-stream")
