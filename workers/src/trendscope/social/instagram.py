"""Instagram Graph API — Business Discovery (officieel).

Met een eigen Instagram Business-account kun je publieke basisgegevens van andere zakelijke of creator-accounts
opvragen: GET /{ig-user-id}?fields=business_discovery.username(<handle>){followers_count,media_count,
media.limit(12){caption,like_count,comments_count,timestamp,permalink,media_type}}
Persoonlijke accounts zijn niet op te vragen (en dat willen we ook niet: AVG).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import quote

from trendscope.core.http import PoliteHttpClient

FIELDS = (
    "business_discovery.username({u}){{username,name,biography,followers_count,media_count,profile_picture_url,"
    "media.limit(12){{caption,like_count,comments_count,timestamp,permalink,media_type}}}}"
)


@dataclass(frozen=True)
class IgMedia:
    permalink: str
    caption: str
    likes: int
    comments: int
    posted_at: datetime
    media_type: str


@dataclass(frozen=True)
class IgProfile:
    username: str
    name: str | None
    followers: int
    media_count: int
    avatar: str | None
    media: list[IgMedia]

    @property
    def engagement_rate(self) -> float | None:
        """(likes + reacties) per post / volgers, over de recente posts."""
        if not self.media or not self.followers:
            return None
        per_post = sum(m.likes + m.comments for m in self.media) / len(self.media)
        return round(per_post / self.followers, 4)


def parse_profile(payload: bytes) -> IgProfile:
    data = json.loads(payload)
    if "error" in data:
        raise RuntimeError(f"Instagram Graph API: {data['error'].get('message')}")
    bd = data["business_discovery"]
    media = [
        IgMedia(
            permalink=m.get("permalink", ""),
            caption=(m.get("caption") or "")[:2000],
            likes=int(m.get("like_count") or 0),
            comments=int(m.get("comments_count") or 0),
            posted_at=datetime.fromisoformat(m["timestamp"].replace("+0000", "+00:00")),
            media_type=m.get("media_type", ""),
        )
        for m in (bd.get("media") or {}).get("data", [])
    ]
    return IgProfile(
        username=bd["username"],
        name=bd.get("name"),
        followers=int(bd.get("followers_count") or 0),
        media_count=int(bd.get("media_count") or 0),
        avatar=bd.get("profile_picture_url"),
        media=media,
    )


def business_discovery(client: PoliteHttpClient, token: str, ig_user_id: str, handle: str, version: str) -> IgProfile:
    url = f"https://graph.facebook.com/{version}/{ig_user_id}?fields={quote(FIELDS.format(u=handle))}&access_token={token}"
    return parse_profile(client.get(url).content)
