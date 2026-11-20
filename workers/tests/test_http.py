import httpx
import pytest

from trendscope.connectors.base import ConnectorNotPermitted, get_connector
from trendscope.core.http import PoliteHttpClient, RobotsDisallowed
from trendscope.core.ratelimit import TokenBucket
from trendscope.core.settings import Settings


def make_client(handler, **kw):
    sleeps: list[float] = []
    client = PoliteHttpClient(
        "TestBot/1.0", per_domain_rps=1000, transport=httpx.MockTransport(handler), sleep=sleeps.append, **kw
    )
    return client, sleeps


def test_respects_robots_txt():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private\n")
        return httpx.Response(200, json={"ok": True})

    client, _ = make_client(handler)
    assert client.get("https://shop.example/public").status == 200
    with pytest.raises(RobotsDisallowed):
        client.get("https://shop.example/private/data")


def test_retries_with_retry_after():
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, headers={"Retry-After": "7"})
        return httpx.Response(200, text="ok")

    client, sleeps = make_client(handler)
    assert client.get("https://shop.example/x").content == b"ok"
    assert sleeps == [7.0, 7.0]


def test_conditional_request_not_modified():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        assert req.headers["If-None-Match"] == '"abc"'
        return httpx.Response(304)

    client, _ = make_client(handler)
    assert client.get("https://shop.example/x", etag='"abc"').not_modified


def test_sends_identifiable_user_agent():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["User-Agent"] == "TestBot/1.0"
        return httpx.Response(404 if req.url.path == "/robots.txt" else 200)

    client, _ = make_client(handler)
    client.get("https://shop.example/")


def test_token_bucket_waits():
    t = {"now": 0.0}
    waits: list[float] = []

    def sleep(s: float) -> None:
        waits.append(s)
        t["now"] += s

    bucket = TokenBucket(rate=2, capacity=1, clock=lambda: t["now"], sleep=sleep)
    bucket.acquire()
    bucket.acquire()
    assert waits == [0.5]


def test_production_blocks_unreviewed_connector():
    connector = get_connector("shopify_storefront", Settings(app_env="production", data_mode="mock"))
    with pytest.raises(ConnectorNotPermitted):
        connector.run(
            "brightnest.example",
            client=PoliteHttpClient("x", transport=httpx.MockTransport(lambda r: httpx.Response(500))),
        )


def test_clickhouse_statement_splitting():
    from trendscope.core.clickhouse import split_statements

    sql = "-- comment\nCREATE TABLE a (x UInt8)\nENGINE = Memory\n;\n\nCREATE TABLE b (y String) ENGINE = Memory\n;\n"
    assert split_statements(sql) == [
        "CREATE TABLE a (x UInt8)\nENGINE = Memory",
        "CREATE TABLE b (y String) ENGINE = Memory",
    ]
