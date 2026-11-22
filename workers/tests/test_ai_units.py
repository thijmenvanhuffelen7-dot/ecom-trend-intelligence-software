"""Creative-analyse offline (regelgebaseerd) en het schema dat ook live wordt gebruikt."""

import pytest

from trendscope.ai.creatives import CreativeAnalysis, offline_analysis


@pytest.mark.parametrize(
    ("body", "hook_type"),
    [
        ("Why is nobody talking about this mug?\n\nSelf-Stirring Mug — free shipping today only.", "question"),
        ("30% off everything this weekend. Shop now", "discount"),
        ("I tested the ice roller for 30 days. Honest review inside.", "testimonial"),
        ("Tired of tangled cables? This fixes it.", "problem"),
        ("The jar that went viral on TikTok 🌊", "social_proof"),
    ],
)
def test_offline_hook_types(body, hook_type):
    assert offline_analysis(body, "Title").hook_type == hook_type


def test_offline_extracts_cta_and_claims():
    a = offline_analysis(
        "Why is nobody talking about mug?\n\nMug — free shipping today only. ⭐⭐⭐⭐⭐ 4.8/5 from 2,000+ customers. Shop now",
        "Mug",
    )
    assert a.hook == "Why is nobody talking about mug?"
    assert a.cta and a.cta.lower() == "shop now"
    assert any("free shipping" in c.lower() for c in a.claims) and any("4.8/5" in c for c in a.claims)
    assert isinstance(a, CreativeAnalysis) and a.ocr_text == "Mug"


def test_schema_has_no_open_ended_hook_types():
    schema = CreativeAnalysis.model_json_schema()
    assert set(schema["properties"]["hook_type"]["enum"]) >= {"question", "discount", "other"}
