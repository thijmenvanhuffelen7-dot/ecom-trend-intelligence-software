"""Ad-creatives analyseren: tekst in het beeld (OCR), de hook, het type hook, de invalshoek, CTA en claims.

- Live (ANTHROPIC_API_KEY): Claude met het beeld (thumbnail/eerste frame uit onze eigen S3) en de adtekst, gestructureerde
  output via een Pydantic-schema. Één verzoek per ad, alleen voor ads die nog niet geanalyseerd zijn.
- Transcriptie van video-audio: optioneel via een lokaal Whisper-model (faster-whisper) als dat geïnstalleerd is en
  WHISPER_MODEL is gezet; de Claude API verwerkt geen audio. Zonder Whisper slaan we transcriptie over.
- Zonder sleutel: regelgebaseerd uit de adtekst (hook = eerste zin, type via patronen). Zo werkt de UI altijd.
"""

from __future__ import annotations

import base64
import re
from datetime import datetime
from typing import Any, Literal

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from trendscope.core.settings import Settings

MODEL = "claude-opus-5-5"
HookType = Literal["question", "problem", "social_proof", "discount", "curiosity", "demo", "testimonial", "other"]


class CreativeAnalysis(BaseModel):
    ocr_text: str = Field(description="Alle leesbare tekst in het beeld, letterlijk; leeg als er geen tekst is")
    hook: str = Field(description="De openingszin of het openingsbeeld dat de aandacht pakt, max. 15 woorden")
    hook_type: HookType
    angle: str = Field(description="De verkoopinvalshoek in 2-5 woorden, bv. 'probleem → oplossing'")
    cta: str | None = Field(description="Call-to-action, letterlijk, of null")
    claims: list[str] = Field(description="Concrete beloftes/claims in de ad (max. 5)")
    summary: str = Field(description="Eén zin: wat de ad doet en voor wie")


# Volgorde telt: het eerste patroon dat past wint (een herkenbaar probleem is sterker dan de vraagvorm)
PATTERNS: list[tuple[HookType, str]] = [
    ("problem", r"(tired of|stop|no more|geen .* meer|probleem|problem|struggle|hate)"),
    ("discount", r"\d+\s?%|korting|off\b|sale|gratis|free shipping"),
    ("social_proof", r"(viral|everyone|iedereen|bestseller|\d[\d,.]*\+?\s*(customers|klanten|reviews)|sold out)"),
    ("testimonial", r"(i tried|i tested|ik heb .* getest|my (wife|husband|mom)|honest review)"),
    ("question", r"\?\s*$|^(why|how|what|did you|waarom|hoe|wat|wist je)\b"),
    ("demo", r"(watch|kijk|see how|zie hoe|in \d+ seconds|in \d+ seconden)"),
    ("curiosity", r"(nobody|niemand|secret|geheim|you won.t believe|this changed|dit veranderde)"),
]


def offline_analysis(body: str | None, headline: str | None) -> CreativeAnalysis:
    text = (body or "").strip()
    first = re.split(r"(?<=[.!?])\s+|\n", text, maxsplit=1)[0][:120] if text else (headline or "")
    hook_type: HookType = next((t for t, p in PATTERNS if re.search(p, first, re.I)), "other")
    claims = [
        c.strip()
        for c in re.findall(
            r"(free shipping[^.!]*|\d+(?:[.,]\d+)?/5[^.!]*|\d[\d,.]*\+? (?:customers|klanten)[^.!]*)", text, re.I
        )
    ][:5]
    cta = next(
        (
            m.group(0)
            for m in [re.search(r"(shop now|bestel nu|order now|buy now|claim[^.!]*|koop nu)", text, re.I)]
            if m
        ),
        None,
    )
    angle = {
        "discount": "korting/urgentie",
        "social_proof": "social proof",
        "problem": "probleem → oplossing",
        "question": "nieuwsgierigheid",
        "testimonial": "ervaring",
        "demo": "demonstratie",
        "curiosity": "nieuwsgierigheid",
    }.get(hook_type, "product in beeld")
    return CreativeAnalysis(
        ocr_text=headline or "",
        hook=first,
        hook_type=hook_type,
        angle=angle,
        cta=cta,
        claims=claims,
        summary=f"{angle.capitalize()}: {first}",
    )


def live_analysis(
    client: Any, body: str | None, headline: str | None, image: tuple[bytes, str] | None
) -> CreativeAnalysis | None:
    content: list[dict[str, Any]] = []
    if image:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image[1],
                    "data": base64.standard_b64encode(image[0]).decode(),
                },
            }
        )
    content.append(
        {
            "type": "text",
            "text": f"Analyze this ad creative.\n<ad_copy>\nheadline: {headline or ''}\nbody: {body or ''}\n</ad_copy>",
        }
    )
    response = client.beta.messages.parse(
        model=MODEL,
        max_tokens=4000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low"},
        system="You analyze e-commerce ads for marketers. Transcribe on-image text exactly (OCR). Be factual; don't invent claims that aren't in the ad.",
        messages=[{"role": "user", "content": content}],
        output_format=CreativeAnalysis,
    )
    if response.stop_reason == "refusal":
        return None
    parsed: CreativeAnalysis | None = response.parsed_output
    return parsed


def _image_for(row: dict[str, Any]) -> tuple[bytes, str] | None:
    """Alleen beelden uit onze eigen opslag (geen hotlinking naar platform-CDN's)."""
    url = row.get("thumbnail_url") or ""
    m = re.match(r"^/api/media/(.+)$", url)
    if not m:
        return None
    try:
        from trendscope.media.storage import get_asset

        data, media_type = get_asset(m.group(1))
        return (data, media_type) if media_type in ("image/png", "image/jpeg", "image/webp", "image/gif") else None
    except Exception:  # noqa: BLE001 — zonder beeld analyseren we alleen de tekst
        return None


def transcribe(video_path: str, settings: Settings) -> str | None:
    """Lokaal met faster-whisper (optioneel geïnstalleerd). Geen netwerk; het model staat lokaal."""
    if not settings.whisper_model:
        return None
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    model = WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(video_path, vad_filter=True)
    return " ".join(s.text.strip() for s in segments)[:20_000] or None


def analyze_ads(
    conn: psycopg.Connection[Any], settings: Settings, now: datetime, *, limit: int = 200
) -> dict[str, int]:
    client = None
    if settings.anthropic_api_key:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    stats = {"analyzed": 0, "live": 0, "offline": 0, "skipped": 0}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT id, body, headline, thumbnail_url FROM ads WHERE analyzed_at IS NULL AND (body IS NOT NULL OR headline IS NOT NULL)
               ORDER BY is_active DESC, start_date DESC NULLS LAST LIMIT %s""",
            (limit,),
        )
        rows = cur.fetchall()
    for row in rows:
        result: CreativeAnalysis | None = None
        model = "offline"
        if client is not None:
            try:
                result = live_analysis(client, row["body"], row["headline"], _image_for(row))
                model = MODEL
            except Exception as exc:  # noqa: BLE001 — één mislukte ad mag de batch niet stoppen
                print(f"creative-analyse ad {row['id']}: {type(exc).__name__}")
                result = None
        if result is None:
            result = offline_analysis(row["body"], row["headline"])
            model = "offline"
        conn.execute(
            """UPDATE ads SET hook = %s, angle = %s, ocr_text = COALESCE(NULLIF(%s, ''), ocr_text),
                 ai_summary = %s, analyzed_at = %s WHERE id = %s""",
            (result.hook, result.angle, result.ocr_text, Jsonb(result.model_dump() | {"model": model}), now, row["id"]),
        )
        stats["analyzed"] += 1
        stats["live" if model != "offline" else "offline"] += 1
    conn.commit()
    return stats
