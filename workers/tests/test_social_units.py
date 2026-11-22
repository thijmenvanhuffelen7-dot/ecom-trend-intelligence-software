"""Social-parsers en hulpfuncties: partner-API, YouTube Data API, Instagram Business Discovery."""

import json

import pytest

from trendscope.social import instagram, partner, youtube
from trendscope.social.ingest import estimate, hashtags_of


def test_partner_creator_keeps_only_public_business_contact():
    payload = {
        "creator": {
            "handle": "glowwithsam",
            "name": "Sam",
            "followers": 120000,
            "contact": {"business_email": "collab@x.example"},
            "phone": "+31600000000",
        },
        "videos": [
            {
                "video_id": "v1",
                "caption": "wow #glow #tiktokmademebuyit",
                "posted_at": "2026-11-20T17:00:00Z",
                "views": 1000,
                "likes": 50,
                "comments": 3,
                "shares": 4,
                "product_id": "p1",
                "url": "https://t/v1",
            }
        ],
        "lives": [
            {
                "live_id": "l1",
                "title": "Live",
                "started_at": "2026-11-19T19:00:00Z",
                "duration_min": 90,
                "peak_viewers": 300,
                "total_viewers": 2000,
                "products": [{"product_id": "p1", "units_sold": 12}],
            }
        ],
    }
    c, vids, lives = partner.parse_creator(payload)
    assert c.business_email == "collab@x.example"
    assert not hasattr(c, "phone"), "alleen zakelijk gepubliceerde e-mail, geen telefoonnummers"
    assert vids[0].product_id == "p1" and vids[0].posted_at.tzinfo is not None
    assert lives[0].products == [("p1", 12)]


def test_partner_shop_and_category():
    shop = partner.parse_shop(
        {
            "shop": {"shop_id": "s1", "name": "Glow Co"},
            "products": [{"product_id": "p1", "shop_id": "s1", "title": "Serum", "price": "12.90", "sold_count": 1520}],
        }
    )
    assert shop.products[0].sold_count == 1520 and str(shop.products[0].price) == "12.90"
    prods, handles = partner.parse_category({"products": [], "creators": [{"handle": "a"}, {"handle": "b"}]})
    assert prods == [] and handles == ["a", "b"]


def test_youtube_parsers_handle_hidden_counts():
    vids = youtube.parse_videos(
        json.dumps(
            {
                "items": [
                    {
                        "id": "abc",
                        "snippet": {
                            "channelId": "UC1",
                            "channelTitle": "Ch",
                            "title": "Review",
                            "publishedAt": "2026-11-01T10:00:00Z",
                        },
                        "statistics": {"viewCount": "1200"},
                    }
                ]
            }
        ).encode()
    )
    assert vids[0].views == 1200 and vids[0].likes == 0
    chans = youtube.parse_channels(
        json.dumps(
            {
                "items": [
                    {
                        "id": "UC1",
                        "snippet": {"title": "Ch", "customUrl": "@chan"},
                        "statistics": {"hiddenSubscriberCount": True, "videoCount": "10"},
                    }
                ]
            }
        ).encode()
    )
    assert chans[0].subscribers is None and chans[0].handle == "chan"
    with pytest.raises(RuntimeError, match="quota"):
        youtube.parse_videos(json.dumps({"error": {"code": 403, "message": "quota exceeded"}}).encode())


def test_instagram_engagement_rate():
    payload = {
        "business_discovery": {
            "username": "brand",
            "followers_count": 10000,
            "media_count": 5,
            "media": {
                "data": [
                    {
                        "caption": "a",
                        "like_count": 300,
                        "comments_count": 20,
                        "timestamp": "2026-11-01T10:00:00+0000",
                        "media_type": "VIDEO",
                    },
                    {
                        "caption": "b",
                        "like_count": 100,
                        "comments_count": 0,
                        "timestamp": "2026-11-02T10:00:00+0000",
                        "media_type": "IMAGE",
                    },
                ]
            },
        }
    }
    prof = instagram.parse_profile(json.dumps(payload).encode())
    assert prof.engagement_rate == pytest.approx(0.021)
    with pytest.raises(RuntimeError, match="Invalid"):
        instagram.parse_profile(json.dumps({"error": {"message": "Invalid OAuth access token."}}).encode())


def test_estimate_and_hashtags():
    e = estimate(1000, low=0.8, high=1.15, confidence="medium", method="x")
    assert e["low"] == 800 and e["high"] == 1150 and e["confidence"] == "medium"
    assert hashtags_of("Wow this works #GlowUp #tiktokmademebuyit and #skin") == ["glowup", "tiktokmademebuyit", "skin"]
