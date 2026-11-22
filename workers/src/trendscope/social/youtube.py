"""YouTube Data API v3 (officieel, API-key). Quota: search = 100 eenheden, list = 1 eenheid per aanvraag.

- search.list   type=video, q, order=date, publishedAfter → video-id's (duur: spaarzaam gebruiken)
- videos.list   part=snippet,statistics, id=… (max 50) → titel, kanaal, views, likes, reacties
- channels.list part=snippet,statistics, id=… (max 50) → abonnees, aantal video's
Alleen publieke kanaal- en videogegevens; geen kijkers of reageerders.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlencode

from trendscope.core.http import PoliteHttpClient

BASE = "https://www.googleapis.com/youtube/v3"


@dataclass(frozen=True)
class YtVideo:
    video_id: str
    channel_id: str
    channel_title: str
    title: str
    description: str
    published_at: datetime
    thumbnail: str | None
    views: int
    likes: int
    comments: int


@dataclass(frozen=True)
class YtChannel:
    channel_id: str
    title: str
    handle: str | None
    country: str | None
    thumbnail: str | None
    subscribers: int | None  # None als het kanaal het aantal verbergt
    videos: int


def _check(data: dict[str, object]) -> None:
    if "error" in data:
        err = data["error"]
        msg = err.get("message") if isinstance(err, dict) else err
        raise RuntimeError(f"YouTube API: {msg}")


def search_video_ids(
    client: PoliteHttpClient, key: str, q: str, published_after: datetime, max_results: int = 25
) -> list[str]:
    params = {
        "part": "id",
        "type": "video",
        "q": q,
        "order": "date",
        "maxResults": max_results,
        "publishedAfter": published_after.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "key": key,
    }
    data = json.loads(client.get(f"{BASE}/search?{urlencode(params)}").content)
    _check(data)
    return [i["id"]["videoId"] for i in data.get("items", []) if i.get("id", {}).get("videoId")]


def parse_videos(payload: bytes) -> list[YtVideo]:
    data = json.loads(payload)
    _check(data)
    out = []
    for it in data.get("items", []):
        sn, st = it.get("snippet", {}), it.get("statistics", {})
        thumbs = sn.get("thumbnails", {})
        out.append(
            YtVideo(
                video_id=it["id"],
                channel_id=sn.get("channelId", ""),
                channel_title=sn.get("channelTitle", ""),
                title=sn.get("title", ""),
                description=sn.get("description", "")[:2000],
                published_at=datetime.fromisoformat(sn["publishedAt"].replace("Z", "+00:00")),
                thumbnail=(thumbs.get("medium") or thumbs.get("default") or {}).get("url"),
                views=int(st.get("viewCount", 0)),
                likes=int(st.get("likeCount", 0)),  # ontbreekt als de maker likes verbergt
                comments=int(st.get("commentCount", 0)),
            )
        )
    return out


def videos(client: PoliteHttpClient, key: str, ids: list[str]) -> list[YtVideo]:
    out: list[YtVideo] = []
    for i in range(0, len(ids), 50):
        params = {"part": "snippet,statistics", "id": ",".join(ids[i : i + 50]), "key": key}
        out += parse_videos(client.get(f"{BASE}/videos?{urlencode(params)}").content)
    return out


def parse_channels(payload: bytes) -> list[YtChannel]:
    data = json.loads(payload)
    _check(data)
    out = []
    for it in data.get("items", []):
        sn, st = it.get("snippet", {}), it.get("statistics", {})
        out.append(
            YtChannel(
                channel_id=it["id"],
                title=sn.get("title", ""),
                handle=(sn.get("customUrl") or "").lstrip("@") or None,
                country=sn.get("country"),
                thumbnail=(sn.get("thumbnails", {}).get("default") or {}).get("url"),
                subscribers=None if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0)),
                videos=int(st.get("videoCount", 0)),
            )
        )
    return out


def channels(client: PoliteHttpClient, key: str, ids: list[str]) -> list[YtChannel]:
    out: list[YtChannel] = []
    for i in range(0, len(ids), 50):
        params = {"part": "snippet,statistics", "id": ",".join(ids[i : i + 50]), "key": key}
        out += parse_channels(client.get(f"{BASE}/channels?{urlencode(params)}").content)
    return out
