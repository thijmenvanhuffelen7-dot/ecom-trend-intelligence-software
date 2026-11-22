"""Waar mails vandaan komen: een echte IMAP-mailbox (productie) of de mockwereld (demo/tests)."""

from __future__ import annotations

import imaplib
from collections.abc import Sequence
from typing import Protocol


class MailSource(Protocol):
    def fetch(self, since_uid: int, limit: int = 500) -> list[tuple[int, bytes]]:
        """Nieuwe berichten met UID > since_uid, oplopend."""
        ...


class ImapSource:
    """IMAP over TLS (poort 993). Alleen lezen: we markeren niets als gelezen (BODY.PEEK) en verwijderen niets."""

    def __init__(self, host: str, user: str, password: str, folder: str = "INBOX") -> None:
        self.host, self.user, self.password, self.folder = host, user, password, folder

    def fetch(self, since_uid: int, limit: int = 500) -> list[tuple[int, bytes]]:
        out: list[tuple[int, bytes]] = []
        with imaplib.IMAP4_SSL(self.host) as imap:
            imap.login(self.user, self.password)
            imap.select(self.folder, readonly=True)
            typ, data = imap.uid("search", None, f"UID {since_uid + 1}:*")  # type: ignore[arg-type]
            if typ != "OK" or not data or not data[0]:
                return out
            uids = [int(u) for u in data[0].split() if int(u) > since_uid][:limit]
            for uid in uids:
                typ, msg = imap.uid("fetch", str(uid), "(BODY.PEEK[])")
                if typ == "OK" and msg and isinstance(msg[0], tuple):
                    out.append((uid, bytes(msg[0][1])))
        return out


class StaticSource:
    """Vaste lijst berichten (tests en de mockwereld)."""

    def __init__(self, messages: Sequence[tuple[int, bytes]]) -> None:
        self.messages = sorted(messages)

    def fetch(self, since_uid: int, limit: int = 500) -> list[tuple[int, bytes]]:
        return [m for m in self.messages if m[0] > since_uid][:limit]
