"""AES-256-GCM voor kanaalsecrets; zelfde formaat als apps/web/lib/crypto.ts: "v1:" + base64(iv ‖ ciphertext ‖ tag)."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from trendscope.core.settings import get_settings


def _key() -> bytes:
    raw = os.environ.get("APP_ENCRYPTION_KEY", "")
    if raw:
        key = base64.b64decode(raw)
        if len(key) != 32:
            raise ValueError("APP_ENCRYPTION_KEY moet 32 bytes (base64) zijn")
        return key
    if get_settings().is_production:
        raise RuntimeError("APP_ENCRYPTION_KEY ontbreekt")
    return hashlib.sha256(f"trendscope-dev:{os.environ.get('AUTH_SECRET', '')}".encode()).digest()


def encrypt_json(value: Any) -> str:
    iv = os.urandom(12)
    return "v1:" + base64.b64encode(iv + AESGCM(_key()).encrypt(iv, json.dumps(value).encode(), None)).decode()


def decrypt_json(token: str) -> Any:
    if not token.startswith("v1:"):
        raise ValueError("Onbekend formaat")
    raw = base64.b64decode(token[3:])
    return json.loads(AESGCM(_key()).decrypt(raw[:12], raw[12:], None))
