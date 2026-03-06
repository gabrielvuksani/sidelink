#!/usr/bin/env python3
"""Generate branded Sidelink desktop icon assets.

Outputs:
- build/icons/icon.icns (used by electron-builder mac package)
- build/icons/icon.ico (used by electron-builder Windows package)
- build/icons/icon.iconset/* (Apple iconset source)
- build/icons/icon-1024.png and icon-512.png (preview/source exports)
- ios-helper/SidelinkHelper/Sources/App/Assets.xcassets/AppIcon.appiconset/*
"""

from __future__ import annotations

import subprocess
import sys
import shutil
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except Exception as exc:  # pragma: no cover - script runtime dependency guard
    print("error: Pillow is required (`python3 -m pip install pillow`)", file=sys.stderr)
    raise SystemExit(1) from exc


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = PROJECT_ROOT / "build" / "icons"
ICONSET_DIR = BUILD_DIR / "icon.iconset"
IOS_APPICON_DIR = PROJECT_ROOT / "ios-helper" / "SidelinkHelper" / "Sources" / "App" / "Assets.xcassets" / "AppIcon.appiconset"


def draw_master_icon(size: int = 1024) -> Image.Image:
    start = (48, 91, 255)
    end = (142, 64, 255)

    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)

    # Gradient plate
    for y in range(size):
        t = y / (size - 1)
        r = int(start[0] * (1 - t) + end[0] * t)
        g = int(start[1] * (1 - t) + end[1] * t)
        b = int(start[2] * (1 - t) + end[2] * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # Rounded mask
    corner = int(size * 0.215)
    inset = int(size * 0.03125)
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([(inset, inset), (size - inset, size - inset)], radius=corner, fill=255)
    base.putalpha(mask)

    # Soft top highlight
    overlay = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.ellipse(
        [int(size * 0.12), int(size * 0.08), int(size * 0.9), int(size * 0.59)],
        fill=(255, 255, 255, 45)
    )
    overlay = overlay.filter(ImageFilter.GaussianBlur(int(size * 0.039)))
    base = Image.alpha_composite(base, overlay)

    glyph = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glyph_draw = ImageDraw.Draw(glyph)
    stroke = int(size * 0.0605)

    # Interlocking links
    glyph_draw.rounded_rectangle(
        [int(size * 0.215), int(size * 0.312), int(size * 0.548), int(size * 0.645)],
        radius=int(size * 0.137),
        outline=(255, 255, 255, 240),
        width=stroke,
    )
    glyph_draw.rounded_rectangle(
        [int(size * 0.45), int(size * 0.352), int(size * 0.782), int(size * 0.684)],
        radius=int(size * 0.137),
        outline=(255, 255, 255, 240),
        width=stroke,
    )

    # Punch overlap to visually separate links
    alpha = glyph.getchannel("A")
    alpha_draw = ImageDraw.Draw(alpha)
    alpha_draw.rounded_rectangle(
        [int(size * 0.41), int(size * 0.352), int(size * 0.586), int(size * 0.527)],
        radius=int(size * 0.068),
        fill=0,
    )
    glyph.putalpha(alpha)

    final_icon = Image.alpha_composite(base, glyph)

    # Border polish
    border_draw = ImageDraw.Draw(final_icon)
    border_draw.rounded_rectangle(
        [(inset + 1, inset + 1), (size - inset - 1, size - inset - 1)],
        radius=corner,
        outline=(255, 255, 255, 60),
        width=max(2, int(size * 0.003)),
    )

    return final_icon


def write_pngs(master: Image.Image) -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)

    specs = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }

    master.save(BUILD_DIR / "icon-1024.png")
    master.resize((512, 512), Image.Resampling.LANCZOS).save(BUILD_DIR / "icon-512.png")

    for filename, px in specs.items():
        target = ICONSET_DIR / filename
        master.resize((px, px), Image.Resampling.LANCZOS).save(target)


def build_icns() -> None:
    if sys.platform != "darwin" or shutil.which("iconutil") is None:
        print("Skipping icon.icns generation: iconutil is unavailable on this platform.")
        return

    cmd = [
        "iconutil",
        "--convert",
        "icns",
        "--output",
        str(BUILD_DIR / "icon.icns"),
        str(ICONSET_DIR),
    ]
    subprocess.run(cmd, check=True)


def build_ico(master: Image.Image) -> None:
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    frames = [master.resize(size, Image.Resampling.LANCZOS) for size in sizes]
    frames[0].save(
        BUILD_DIR / "icon.ico",
        format="ICO",
        sizes=sizes,
        append_images=frames[1:],
    )


def write_ios_appiconset(master: Image.Image) -> None:
    IOS_APPICON_DIR.mkdir(parents=True, exist_ok=True)

    specs = [
        {"idiom": "iphone", "size": "20x20", "scale": "2x", "px": 40, "filename": "Icon-App-20x20@2x.png"},
        {"idiom": "iphone", "size": "20x20", "scale": "3x", "px": 60, "filename": "Icon-App-20x20@3x.png"},
        {"idiom": "iphone", "size": "29x29", "scale": "2x", "px": 58, "filename": "Icon-App-29x29@2x.png"},
        {"idiom": "iphone", "size": "29x29", "scale": "3x", "px": 87, "filename": "Icon-App-29x29@3x.png"},
        {"idiom": "iphone", "size": "40x40", "scale": "2x", "px": 80, "filename": "Icon-App-40x40@2x.png"},
        {"idiom": "iphone", "size": "40x40", "scale": "3x", "px": 120, "filename": "Icon-App-40x40@3x.png"},
        {"idiom": "iphone", "size": "60x60", "scale": "2x", "px": 120, "filename": "Icon-App-60x60@2x.png"},
        {"idiom": "iphone", "size": "60x60", "scale": "3x", "px": 180, "filename": "Icon-App-60x60@3x.png"},
        {"idiom": "ipad", "size": "20x20", "scale": "1x", "px": 20, "filename": "Icon-App-20x20@1x.png"},
        {"idiom": "ipad", "size": "20x20", "scale": "2x", "px": 40, "filename": "Icon-App-20x20@2x~ipad.png"},
        {"idiom": "ipad", "size": "29x29", "scale": "1x", "px": 29, "filename": "Icon-App-29x29@1x.png"},
        {"idiom": "ipad", "size": "29x29", "scale": "2x", "px": 58, "filename": "Icon-App-29x29@2x~ipad.png"},
        {"idiom": "ipad", "size": "40x40", "scale": "1x", "px": 40, "filename": "Icon-App-40x40@1x.png"},
        {"idiom": "ipad", "size": "40x40", "scale": "2x", "px": 80, "filename": "Icon-App-40x40@2x~ipad.png"},
        {"idiom": "ipad", "size": "76x76", "scale": "1x", "px": 76, "filename": "Icon-App-76x76@1x.png"},
        {"idiom": "ipad", "size": "76x76", "scale": "2x", "px": 152, "filename": "Icon-App-76x76@2x.png"},
        {"idiom": "ipad", "size": "83.5x83.5", "scale": "2x", "px": 167, "filename": "Icon-App-83.5x83.5@2x.png"},
        {"idiom": "ios-marketing", "size": "1024x1024", "scale": "1x", "px": 1024, "filename": "Icon-App-1024x1024@1x.png"},
    ]

    for spec in specs:
        master.resize((spec["px"], spec["px"]), Image.Resampling.LANCZOS).save(IOS_APPICON_DIR / spec["filename"])

    contents_images = [
        {
            "idiom": spec["idiom"],
            "size": spec["size"],
            "scale": spec["scale"],
            "filename": spec["filename"],
        }
        for spec in specs
    ]

    payload = {
        "images": contents_images,
        "info": {
            "version": 1,
            "author": "xcode",
        },
    }

    import json
    (IOS_APPICON_DIR / "Contents.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    master = draw_master_icon(1024)
    write_pngs(master)
    write_ios_appiconset(master)
    build_icns()
    build_ico(master)
    print(f"Generated desktop icon assets in: {BUILD_DIR}")
    print(f"Generated iOS app icons in: {IOS_APPICON_DIR}")


if __name__ == "__main__":
    main()
