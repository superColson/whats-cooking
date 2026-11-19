"""Draw the What's Cooking icon (cooking pot with steam) with Pillow.

Usage: python3 draw_icon.py OUT_DIR
Writes icon-1024.png (colored app icon) and tray-64.png (white silhouette).
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

S = 4  # supersampling factor


def steam(draw, x0, y_bottom, height, amp, width, color, phase=0.0):
    """Draw one wavy steam wisp as a thick polyline.

    :param draw: ImageDraw target
    :param x0: center x of the wisp
    :param y_bottom: lowest y of the wisp
    :param height: vertical extent
    :param amp: horizontal wave amplitude
    :param width: stroke width
    :param color: RGBA color
    :param phase: wave phase offset in radians
    :return: None
    """
    pts = []
    for i in range(61):
        t = i / 60
        y = y_bottom - t * height
        x = x0 + amp * math.sin(phase + t * 2.2 * math.pi)
        pts.append((x, y))
    draw.line(pts, fill=color, width=width, joint="curve")
    r = width // 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def pot(draw, size, body, lid, knob, handle, steam_color, background=None):
    """Draw the pot, lid and steam on a square canvas.

    :param draw: ImageDraw target
    :param size: canvas size in pixels
    :param body: pot body color
    :param lid: lid color
    :param knob: lid knob color
    :param handle: handle color
    :param steam_color: steam color
    :param background: optional rounded-square background color
    :return: None
    """
    u = size / 1024
    if background:
        draw.rounded_rectangle((64 * u, 64 * u, 960 * u, 960 * u), radius=200 * u, fill=background)
    # steam
    for x0, ph in ((392, 0.0), (512, 1.4), (632, 2.8)):
        steam(draw, x0 * u, 350 * u, 210 * u, 24 * u, int(36 * u), steam_color, ph)
    # handles
    draw.rounded_rectangle((176 * u, 520 * u, 300 * u, 580 * u), radius=30 * u, fill=handle)
    draw.rounded_rectangle((724 * u, 520 * u, 848 * u, 580 * u), radius=30 * u, fill=handle)
    # body
    draw.rounded_rectangle((256 * u, 470 * u, 768 * u, 820 * u), radius=70 * u, fill=body)
    # lid
    draw.rounded_rectangle((226 * u, 430 * u, 798 * u, 490 * u), radius=30 * u, fill=lid)
    draw.rounded_rectangle((462 * u, 392 * u, 562 * u, 440 * u), radius=22 * u, fill=knob)


def main():
    """Render both icons into the output directory.

    :return: None
    """
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    big = 1024 * S
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    pot(ImageDraw.Draw(img), big, body="#e66100", lid="#c64600", knob="#f6f5f4", handle="#9a3b00",
        steam_color=(246, 245, 244, 235), background="#241f31")
    img.resize((1024, 1024), Image.LANCZOS).save(out / "icon-1024.png")
    tray = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    white = (255, 255, 255, 255)
    pot(ImageDraw.Draw(tray), big, body=white, lid=white, knob=white, handle=white, steam_color=white)
    tray.crop((150 * S, 130 * S, 874 * S, 854 * S)).resize((64, 64), Image.LANCZOS).save(out / "tray-64.png")


if __name__ == "__main__":
    main()
