from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any


def _default(value: Any) -> Any:
    if isinstance(value, Decimal):
        # 19.90 en 19.9 zijn dezelfde prijs; 20.00 wordt "20" (niet "2E+1")
        return str(int(value)) if value == value.to_integral() else str(value.normalize())
    if isinstance(value, set | frozenset):
        return sorted(value)
    return str(value)


def content_hash(value: Any) -> str:
    """Stabiele hash: dezelfde inhoud geeft altijd dezelfde hash, ongeacht sleutelvolgorde."""
    encoded = json.dumps(value, sort_keys=True, default=_default, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()[:32]
