#!/usr/bin/env python3
"""Create responsive WebP variants for Daktilo.

Input:  images/*.png, *.jpg, *.jpeg, *.webp
Output: images/480/*.webp, images/800/*.webp, images/1200/*.webp
Also writes images/responsive-manifest.js.

Requires Pillow:
    python -m pip install pillow
"""

from pathlib import Path
import json
import sys

try:
    from PIL import Image, ImageOps
except ImportError:
    raise SystemExit("Pillow fehlt. Installieren mit: python -m pip install pillow")

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "images"
SIZES = (480, 800, 1200)
QUALITY = 84
VALID = {".png", ".jpg", ".jpeg", ".webp"}

sources = [
    p for p in IMAGES.iterdir()
    if p.is_file()
    and p.suffix.lower() in VALID
    and p.name not in {"responsive-manifest.js"}
]

if not sources:
    raise SystemExit("Keine Ausgangsbilder direkt im Ordner images/ gefunden.")

manifest_files = {str(size): [] for size in SIZES}

for source in sorted(sources, key=lambda p: p.name.casefold()):
    stem = source.stem

    with Image.open(source) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "A" in im.getbands() else "RGB")

        for size in SIZES:
            out_dir = IMAGES / str(size)
            out_dir.mkdir(parents=True, exist_ok=True)
            out = out_dir / f"{stem}.webp"

            variant = im.copy()
            # Never upscale. "size" is the maximum long edge, not a forced canvas.
            variant.thumbnail((size, size), Image.Resampling.LANCZOS)
            variant.save(out, "WEBP", quality=QUALITY, method=6, exact=True)
            manifest_files[str(size)].append(stem)

manifest = {
    "enabled": True,
    "sizes": list(SIZES),
    "files": manifest_files,
}

manifest_path = IMAGES / "responsive-manifest.js"
manifest_path.write_text(
    "window.DAKTILO_IMAGE_VARIANTS = " +
    json.dumps(manifest, ensure_ascii=False, indent=2) +
    ";\n",
    encoding="utf-8",
)

print(f"{len(sources)} Ausgangsbilder verarbeitet.")
for size in SIZES:
    total = sum((IMAGES / str(size) / f"{p.stem}.webp").stat().st_size for p in sources)
    print(f"{size}px: {len(sources)} Dateien, {total / 1024 / 1024:.1f} MB")
print("Manifest:", manifest_path)
