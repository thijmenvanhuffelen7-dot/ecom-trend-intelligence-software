import io

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

from trendscope.clustering.embed import HashingEmbedder, cosine
from trendscope.clustering.phash import hamming, image_similarity, phash_bytes, phash_image


def product_image(seed: int, size=400) -> Image.Image:
    import random

    r = random.Random(seed)
    img = Image.new("RGB", (size, size), (r.randint(200, 255),) * 3)
    d = ImageDraw.Draw(img)
    for _ in range(6):
        x, y = r.randint(0, size - 120), r.randint(0, size - 120)
        d.ellipse(
            [x, y, x + r.randint(60, 140), y + r.randint(60, 140)], fill=tuple(r.randint(0, 255) for _ in range(3))
        )
    return img


def test_phash_survives_resize_compression_and_brightness():
    base = product_image(1)
    h = phash_image(base)
    resized = base.resize((180, 180))
    buf = io.BytesIO()
    base.save(buf, "JPEG", quality=40)
    jpeg = phash_bytes(buf.getvalue())
    brighter = ImageEnhance.Brightness(base).enhance(1.25)
    blurred = base.filter(ImageFilter.GaussianBlur(1.2))
    for variant in (phash_image(resized), jpeg, phash_image(brighter), phash_image(blurred)):
        assert hamming(h, variant) <= 8
    other = phash_image(product_image(2))
    assert hamming(h, other) > 16
    assert image_similarity(h, None) is None


def test_phash_fits_signed_bigint():
    for seed in range(20):
        v = phash_image(product_image(seed))
        assert -(2**63) <= v < 2**63


def test_text_embedding_groups_variants_of_the_same_product():
    e = HashingEmbedder()
    a = e.embed("Posture Corrector Pro")
    b = e.embed("2026 New Adjustable Back Posture Corrector Belt for Women Men")
    c = e.embed("Portable Blender Cup USB Rechargeable")
    assert cosine(a, a) > 0.999
    assert cosine(a, b) > cosine(a, c) + 0.2
    assert abs(sum(x * x for x in b) - 1) < 1e-3
