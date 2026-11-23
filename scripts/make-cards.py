#!/usr/bin/env python3
"""Generate the demo video title/end cards (1280x900, Even dark theme)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 900
BG = (35, 35, 35)
GREEN = (0, 255, 100)
TEXT = (229, 229, 229)
MUTED = (154, 154, 154)

FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def card(lines, out_path):
    """lines: list of (text, font_path, size, color, y_offset_from_center)."""
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    total_h = sum(ImageFont.truetype(f, s).size + 24 for _, f, s, _, _ in lines)
    y = (H - total_h) // 2
    for text, font_path, size, color, _ in lines:
        font = ImageFont.truetype(font_path, size)
        bbox = d.textbbox((0, 0), text, font=font)
        x = (W - (bbox[2] - bbox[0])) // 2
        d.text((x, y), text, font=font, fill=color)
        y += font.size + 24
    img.save(out_path)
    print('wrote', out_path)


OUT = Path(__file__).resolve().parent.parent / 'demo'
OUT.mkdir(exist_ok=True)

card(
    [
        ('PerpWatch', FONT_BOLD, 96, GREEN, 0),
        ('Hyperliquid liquidation-risk monitor for Even G2', FONT, 36, TEXT, 0),
        ('One glance: how far is price from your liquidation?', FONT, 28, MUTED, 0),
        ("Even Realities \u2018Heads Up\u2019 Hackathon  \u00b7  Crypto & DeFi track", FONT, 24, MUTED, 0),
    ],
    OUT / 'title-card.png',
)

card(
    [
        ('Read-only  \u00b7  No wallet  \u00b7  No keys', FONT_BOLD, 48, GREEN, 0),
        ('Telegram alerts keep you covered \u2014 even with the glasses off.', FONT, 30, TEXT, 0),
        ('PerpWatch  \u00b7  Solo entry by Abi Tatang  \u00b7  Built 23\u201329 Nov 2026', FONT, 24, MUTED, 0),
    ],
    OUT / 'end-card.png',
)
