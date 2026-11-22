"""Reddit Data API (officieel, OAuth). Alleen posttitels en tellingen, geen gebruikersnamen (AVG).

Token: POST https://www.reddit.com/api/v1/access_token (grant_type=client_credentials, Basic-auth met app-id/secret).
Zoeken: GET https://oauth.reddit.com/search?q=…&sort=new&t=week&limit=100&type=link
Reddit eist een beschrijvende User-Agent; die zet de HTTP-client.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote

from trendscope.core.http import PoliteHttpClient

TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
SEARCH_URL = "https://oauth.reddit.com/search"


@dataclass(frozen=True)
class RedditPost:
    post_id: str
    subreddit: str
    title: str
    url: str
    score: int
    comments: int
    created_at: datetime


def get_token(client: PoliteHttpClient, client_id: str, client_secret: str) -> str:
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    res = client.post(TOKEN_URL, data={"grant_type": "client_credentials"}, headers={"Authorization": f"Basic {basic}"})
    data = json.loads(res.content)
    if "access_token" not in data:
        raise RuntimeError(f"Reddit-token geweigerd: {data.get('error', 'onbekend')}")
    return str(data["access_token"])


def parse_listing(payload: bytes) -> tuple[list[RedditPost], str | None]:
    data = json.loads(payload).get("data") or {}
    posts = []
    for child in data.get("children") or []:
        d = child.get("data") or {}
        if child.get("kind") != "t3" or d.get("over_18"):
            continue
        posts.append(
            RedditPost(
                post_id=str(d["id"]),
                subreddit=str(d.get("subreddit", "")),
                title=str(d.get("title", ""))[:300],
                url="https://www.reddit.com" + str(d.get("permalink", "")),
                score=int(d.get("score") or 0),
                comments=int(d.get("num_comments") or 0),
                created_at=datetime.fromtimestamp(float(d.get("created_utc") or 0), UTC),
            )
        )
    return posts, data.get("after")


def search(client: PoliteHttpClient, token: str, term: str, *, max_pages: int = 3) -> list[RedditPost]:
    out: list[RedditPost] = []
    after: str | None = None
    for _ in range(max_pages):
        url = f"{SEARCH_URL}?q={quote(chr(34) + term + chr(34))}&sort=new&t=week&limit=100&type=link"
        if after:
            url += f"&after={after}"
        posts, after = parse_listing(client.get(url, headers={"Authorization": f"Bearer {token}"}).content)
        out += posts
        if not after:
            break
    return out
