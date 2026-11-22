"""Vaste bouwstenen voor de demo-dataset. Alle winkels, merken en creators zijn fictief."""

from __future__ import annotations

# slug, NL, EN, emoji
NICHES: list[tuple[str, str, str, str]] = [
    ("food-grocery", "Voeding & boodschappen", "Food & Grocery", "🥫"),
    ("natural-health", "Natuurlijke gezondheid", "Natural & Alternative Health", "🌿"),
    ("skincare", "Huid- & lichaamsverzorging", "Skincare & Body Care", "🧴"),
    ("home-kitchen", "Huis & keuken", "Home & Kitchen", "🍳"),
    ("fitness", "Fitness & sport", "Fitness & Sports", "🏋️"),
    ("pets", "Huisdieren", "Pets", "🐾"),
    ("baby-kids", "Baby & kind", "Baby & Kids", "🧸"),
    ("fashion-accessories", "Mode-accessoires", "Fashion Accessories", "👜"),
    ("tech-gadgets", "Tech & gadgets", "Tech & Gadgets", "🔌"),
    ("home-decor", "Woondecoratie", "Home Decor", "🪴"),
    ("outdoor", "Outdoor & reizen", "Outdoor & Travel", "🏕️"),
    ("beauty-tools", "Beauty-tools", "Beauty Tools", "💄"),
]

# niche -> [(producttitel, emoji, verkoopprijs EUR, inkoopprijs USD, categorie)]
PRODUCTS: dict[str, list[tuple[str, str, float, float, str]]] = {
    "food-grocery": [
        ("Wild Oregano Oil Drops", "🫒", 29.95, 4.10, "Supplements"),
        ("Black Seed Oil Capsules", "⚫", 32.00, 5.20, "Supplements"),
        ("Organic Matcha Starter Kit", "🍵", 39.00, 9.80, "Tea"),
        ("Electrolyte Hydration Sticks", "💧", 27.50, 3.40, "Drinks"),
        ("Mushroom Coffee Blend", "🍄", 44.00, 7.90, "Coffee"),
        ("Protein Pancake Mix", "🥞", 24.95, 4.50, "Breakfast"),
    ],
    "natural-health": [
        ("Garlic Extract Softgels", "🧄", 26.00, 3.10, "Supplements"),
        ("Amla Hair Growth Serum", "🌱", 34.95, 4.80, "Hair"),
        ("Castor Oil Eye Pads", "👁️", 22.00, 2.30, "Remedies"),
        ("Magnesium Sleep Spray", "🌙", 29.00, 3.60, "Sleep"),
        ("Lymphatic Drainage Oil", "🫧", 38.00, 5.10, "Body"),
        ("Sea Moss Gel Jar", "🌊", 35.00, 6.40, "Superfoods"),
    ],
    "skincare": [
        ("Peptide Lip Treatment", "💋", 24.00, 2.20, "Lips"),
        ("Snail Mucin Essence", "🐌", 31.00, 4.90, "Face"),
        ("Blue Light Night Mask", "😴", 49.00, 11.50, "Face"),
        ("Ice Roller Pro", "🧊", 19.95, 2.70, "Tools"),
        ("Collagen Overnight Wrap", "🌸", 36.00, 5.60, "Face"),
        ("SPF 50 Tinted Stick", "☀️", 28.00, 3.90, "Sun"),
    ],
    "home-kitchen": [
        ("Portable Blender Cup", "🥤", 39.95, 8.40, "Appliances"),
        ("Self-Stirring Mug", "☕", 29.95, 5.10, "Drinkware"),
        ("Electric Spice Grinder", "🌶️", 34.00, 7.20, "Appliances"),
        ("Vacuum Seal Food Lids", "🥡", 24.95, 3.30, "Storage"),
        ("Oil Sprayer Bottle", "🫗", 17.95, 1.90, "Cooking"),
        ("Smart Meat Thermometer", "🌡️", 59.00, 14.20, "Gadgets"),
    ],
    "fitness": [
        ("Smart Jump Rope", "🪢", 34.95, 6.10, "Cardio"),
        ("Posture Corrector Pro", "🧍", 34.95, 4.20, "Recovery"),
        ("Mini Massage Gun", "💪", 69.00, 18.50, "Recovery"),
        ("Resistance Band Set", "🎽", 29.00, 4.10, "Strength"),
        ("Pilates Wall Ring", "⭕", 39.00, 6.80, "Pilates"),
        ("Grip Strength Trainer", "✊", 19.95, 2.40, "Strength"),
    ],
    "pets": [
        ("Self-Cleaning Cat Brush", "🐈", 22.95, 2.60, "Grooming"),
        ("Dog Paw Cleaner Cup", "🐕", 27.95, 3.90, "Grooming"),
        ("Interactive Laser Toy", "🔴", 32.00, 5.30, "Toys"),
        ("Lick Mat Slow Feeder", "🍽️", 19.00, 1.80, "Feeding"),
        ("Pet Hair Remover Roller", "🧹", 24.95, 2.90, "Cleaning"),
        ("Calming Donut Bed", "🍩", 49.00, 11.00, "Beds"),
    ],
    "baby-kids": [
        ("Montessori Busy Board", "🧩", 44.00, 8.90, "Toys"),
        ("Star Night Light Projector", "🌌", 39.00, 6.70, "Nursery"),
        ("Silicone Suction Plate", "🥣", 18.95, 2.10, "Feeding"),
        ("Magnetic Drawing Board", "✏️", 26.00, 3.80, "Toys"),
        ("Baby Nail Trimmer", "✂️", 24.95, 3.20, "Care"),
        ("Toddler Water Doodle Mat", "🎨", 29.00, 4.60, "Toys"),
    ],
    "fashion-accessories": [
        ("Noise-Reducing Ear Plugs", "🎧", 24.95, 1.60, "Accessories"),
        ("Claw Clip Set", "🦀", 19.00, 1.40, "Hair"),
        ("Minimalist Card Wallet", "💳", 34.00, 4.20, "Wallets"),
        ("Pearl Hair Pins", "🦪", 16.95, 1.10, "Hair"),
        ("Belt Bag Crossbody", "👝", 39.00, 6.30, "Bags"),
        ("Silk Sleep Scrunchies", "🎀", 22.00, 1.90, "Hair"),
    ],
    "tech-gadgets": [
        ("Magnetic Power Bank", "🔋", 44.95, 9.80, "Charging"),
        ("Mini Thermal Printer", "🖨️", 49.00, 11.90, "Gadgets"),
        ("Smart Ring Sleep Tracker", "💍", 129.00, 34.00, "Wearables"),
        ("3-in-1 Charging Stand", "⚡", 59.00, 12.40, "Charging"),
        ("Bluetooth Item Tracker", "📍", 29.00, 4.70, "Gadgets"),
        ("Clip-On Phone Lens Kit", "📷", 34.00, 5.10, "Photo"),
    ],
    "home-decor": [
        ("Sunset Projection Lamp", "🌅", 34.95, 5.40, "Lighting"),
        ("Wave Mirror", "🪞", 79.00, 19.80, "Mirrors"),
        ("Flame Aroma Diffuser", "🔥", 49.00, 10.20, "Aroma"),
        ("Cordless Table Lamp", "💡", 59.00, 12.60, "Lighting"),
        ("Bouclé Cushion Cover", "🛋️", 29.00, 4.40, "Textiles"),
        ("Moss Wall Art", "🖼️", 89.00, 22.00, "Wall"),
    ],
    "outdoor": [
        ("Collapsible Water Bottle", "🧴", 24.00, 2.90, "Hydration"),
        ("Packable Rain Poncho", "🌧️", 29.00, 3.70, "Apparel"),
        ("Solar Camping Lantern", "🏮", 39.00, 7.40, "Camping"),
        ("Hammock Bug Net", "🦟", 44.00, 7.10, "Camping"),
        ("Neck Fan Hands-Free", "🌀", 34.95, 5.60, "Cooling"),
        ("Travel Compression Cubes", "🧳", 32.00, 4.80, "Travel"),
    ],
    "beauty-tools": [
        ("Makeup Blending Sponge", "🥚", 16.95, 0.90, "Makeup"),
        ("Heatless Curling Rod", "➰", 24.95, 1.80, "Hair"),
        ("LED Face Mask", "🎭", 149.00, 39.00, "Devices"),
        ("Gua Sha Stone Set", "💎", 29.00, 3.40, "Face"),
        ("Brow Lamination Kit", "🪮", 34.00, 4.10, "Brows"),
        ("Cordless Hair Straightener", "🔆", 79.00, 17.50, "Hair"),
    ],
}

NAME_HEADS = [
    "Resi",
    "Lumo",
    "Velo",
    "Nova",
    "Aure",
    "Sola",
    "Mira",
    "Kora",
    "Elio",
    "Brio",
    "Zeny",
    "Halo",
    "Vita",
    "Opal",
    "Lyra",
    "Sero",
    "Nimbu",
    "Calo",
    "Pura",
    "Terra",
    "Ondi",
    "Flora",
    "Nesto",
    "Avel",
    "Maro",
    "Ivo",
    "Celes",
    "Bloo",
    "Kindr",
    "Wello",
    "Smoo",
    "Lympho",
    "Alev",
    "Glow",
    "Hearth",
    "Dune",
    "Fable",
    "Oaky",
    "Tula",
    "Rove",
]
NAME_TAILS = [
    "lia",
    "ra",
    "vy",
    "na",
    "ly",
    "che",
    "ria",
    "ma",
    "ora",
    "ix",
    "io",
    "ette",
    "en",
    "ou",
    "va",
    "phoria",
    "sa",
    "nest",
    "bloom",
    "loop",
    "well",
    "co",
    "lab",
    "haus",
]
TLDS = [".com", ".com", ".com", ".co", ".shop", ".store", ".nl", ".de", ".co.uk", ".com.au"]

COUNTRIES = [
    ("US", 0.38),
    ("GB", 0.12),
    ("NL", 0.09),
    ("DE", 0.09),
    ("FR", 0.07),
    ("AU", 0.08),
    ("CA", 0.07),
    ("BE", 0.04),
    ("SE", 0.03),
    ("IT", 0.03),
]
CURRENCY = {
    "US": "USD",
    "GB": "GBP",
    "NL": "EUR",
    "DE": "EUR",
    "FR": "EUR",
    "AU": "AUD",
    "CA": "CAD",
    "BE": "EUR",
    "SE": "SEK",
    "IT": "EUR",
}
LANGUAGE = {
    "US": "en",
    "GB": "en",
    "NL": "nl",
    "DE": "de",
    "FR": "fr",
    "AU": "en",
    "CA": "en",
    "BE": "nl",
    "SE": "sv",
    "IT": "it",
}

THEMES = [
    "Dawn",
    "Impulse",
    "Prestige",
    "Sense",
    "Craft",
    "Motion",
    "Symmetry",
    "Refresh",
    "Broadcast",
    "Be Yours",
    "Shrine Pro",
    "Kalles",
]

TECH: dict[str, list[str]] = {
    "pixel": [
        "Meta Pixel",
        "TikTok Pixel",
        "Google Analytics 4",
        "Google Ads",
        "Google Tag Manager",
        "Pinterest Tag",
        "Snap Pixel",
        "Microsoft Advertising",
        "Taboola",
        "Reddit Pixel",
    ],
    "app": [
        "Klaviyo",
        "Judge.me",
        "Loox",
        "ReCharge",
        "Triple Whale",
        "Gorgias",
        "Okendo",
        "Rebuy",
        "PageFly",
        "Shogun",
        "Afterpay",
        "Intelligems",
        "Postscript",
        "Yotpo",
        "Vitals",
        "Zipify Pages",
    ],
    "payment": ["Shopify Payments", "PayPal", "Klarna", "Afterpay", "Apple Pay", "iDEAL"],
}

CTAS = ["Shop Now", "Learn More", "Order Now", "Get Offer", "Sign Up", "Watch More"]
HOOKS = [
    "I wish I found this sooner…",
    "POV: you finally fixed your {p}",
    "3 reasons everyone is switching to {p}",
    "Stop scrolling if you struggle with this",
    "Our #1 bestseller is back in stock",
    "Dermatologists don't want you to know",
    "This changed my morning routine",
    "50% off ends tonight",
    "Why is nobody talking about {p}?",
    "We sold out 3 times. Here's why.",
    "Watch what happens after 7 days",
    "The {p} that went viral on TikTok",
]

CREATOR_HANDLES = [
    "itsmayalife",
    "homewithnoor",
    "fitbyjules",
    "glowwithsam",
    "momhacks.daily",
    "techbyleo",
    "the.cozy.edit",
    "petsofoliver",
    "dailywellness.ana",
    "kitchenkai",
    "outdoor.ollie",
    "beautyby.lina",
    "minimal.mika",
    "rafa.reviews",
    "sleepysophie",
    "gymgirl.tess",
    "budgetbeauty.bo",
    "dadjokes.and.gadgets",
    "plantmom.priya",
    "travelwith.tom",
]

SUPPLIERS = [
    ("aliexpress", "Shenzhen Brightway Store", 4.7),
    ("aliexpress", "Yiwu Homeful Official", 4.6),
    ("aliexpress", "GlowLab Factory Store", 4.8),
    ("cj", "CJ Dropshipping Warehouse US", 4.5),
    ("cj", "CJ EU Warehouse (DE)", 4.6),
    ("alibaba", "Guangzhou Pure Cosmetics Co.", 4.9),
    ("alibaba", "Ningbo Kitchenware Mfg.", 4.7),
    ("aliexpress", "PetPal Supplies Store", 4.5),
]


GENERIC_HASHTAGS = [
    "tiktokmademebuyit",
    "amazonfinds",
    "giftideas",
    "homefinds",
    "cleantok",
    "skincaretok",
    "kitchenhacks",
]


def hashtags(title: str, salt: object) -> str:
    """'#protein_pancake_mix'-achtige producttag plus een algemene tag; deterministisch per (titel, salt)."""
    import re
    import zlib

    core = re.sub(r"[^a-z0-9]+", "", title.lower().split(" — ")[0])[:30]
    h = zlib.crc32(f"{title}:{salt}".encode())
    if h % 3 == 0:
        return ""  # niet elke ad gebruikt hashtags
    return f" #{core} #{GENERIC_HASHTAGS[h % len(GENERIC_HASHTAGS)]}"


# Funnel-apps: pop-ups, urgentie, upsells, loyaliteit, quiz/chat. Per winkel gekozen via een hash van het domein,
# zodat de rest van de (random) seed niet verschuift.
FUNNEL_APPS = [
    "Privy",
    "Justuno",
    "OptiMonk",
    "Wheelio",
    "Hextom Free Shipping Bar",
    "Hurrify",
    "Sales Pop",
    "Frequently Bought Together",
    "Bold Upsell",
    "Smile.io",
    "LoyaltyLion",
    "Octane AI",
    "Tidio",
]


def funnel_apps(domain: str) -> list[str]:
    import zlib

    h = zlib.crc32(domain.encode())
    n = 2 + h % 3
    return [FUNNEL_APPS[(h // 7 + i * 5) % len(FUNNEL_APPS)] for i in range(n)]
