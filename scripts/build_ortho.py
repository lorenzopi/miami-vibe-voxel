"""Build the cross-referenced Miami aerial orthophoto (Esri World Imagery + USGS NAIP)
and write web/public/data/ortho.jpg (for voxelMaterial.ts) and web/public/data/terrain.bin.
"""
import gzip
import io
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from aoi import D, RAW, W, world_bounds

UA = {"User-Agent": "miami-vibe-voxel/0.1 (aerial ortho cross-reference)"}
TW, TH = W // 2, D // 2  # 2100 x 1900 (0.5 m^-1, matching terrain.bin colour grid)


def fetch_esri_2m(naip_2m):
    cache = Path(RAW) / "esri_2m.png"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        im = Image.open(cache).convert("RGB")
        if im.size == (TW, TH):
            return np.asarray(im, dtype=np.uint8)
    x0, y0, x1, y1 = world_bounds()
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    qw, qh = TW // 2, TH // 2
    base = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
    canvas = naip_2m.copy()
    # Note: y1 is north (top row 0), y0 is south (bottom row TH)
    quads = [
        (x0, ym, xm, y1, 0, qw, 0, qh),
        (xm, ym, x1, y1, qw, TW, 0, qh),
        (x0, y0, xm, ym, 0, qw, qh, TH),
        (xm, y0, x1, ym, qw, TW, qh, TH),
    ]
    ok = 0
    for xa, ya, xb, yb, c0, c1, r0, r1 in quads:
        wi, hi = c1 - c0, r1 - r0
        url = f"{base}?bbox={xa},{ya},{xb},{yb}&bboxSR=6346&imageSR=6346&size={wi},{hi}&format=jpg&f=image"
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=22) as resp:
                im = Image.open(io.BytesIO(resp.read())).convert("RGB")
            if im.size != (wi, hi):
                im = im.resize((wi, hi), Image.Resampling.BILINEAR)
            canvas[r0:r1, c0:c1] = np.asarray(im, dtype=np.uint8)
            ok += 1
        except Exception as exc:
            print(f"  esri tile ({c0},{r0}) fallback to NAIP: {exc}", flush=True)
    if ok:
        Image.fromarray(canvas).save(cache)
    return canvas


def main():
    naip_path = Path(RAW) / "naip_1m.png"
    naip_im = Image.open(naip_path).convert("RGB").resize((TW, TH), Image.Resampling.BILINEAR)
    naip_2m = np.asarray(naip_im, dtype=np.uint8)
    esri_2m = fetch_esri_2m(naip_2m).astype(np.float32)
    naip_f = naip_2m.astype(np.float32)
    # Remove NAIP's slight cyan-green cast on neutral surfaces and blend with Esri World Imagery
    naip_f[..., 1] *= 0.94
    naip_f[..., 0] = np.clip(naip_f[..., 0] * 1.04, 0, 255)
    ortho = np.clip(esri_2m * 0.68 + naip_f * 0.32, 0, 255)

    # Lift deep aerial shadows on roofs/streets so shadow-side roofs don't bake black into the albedo
    lum = ortho @ np.array([0.299, 0.587, 0.114], np.float32)
    lift = np.where(lum < 72, 1.0 + (72 - lum) / 135.0, 1.0)[..., None]
    ortho = np.clip(ortho * lift, 0, 255).astype(np.uint8)

    # Mask open bay water to clean Biscayne blue so aerial boat wakes / seams don't bake onto water
    gz = np.load("data/ground.npz")
    g = gz["g"]
    rgb = gz["rgb"]
    bay_rgb = np.median(rgb[:, 3500:], axis=(0, 1)).astype(int)
    water = np.all(np.abs(rgb.astype(int) - bay_rgb) <= 6, axis=-1)
    water_2m = water[1::2, 1::2]
    ortho[water_2m] = (42, 144, 176)

    out_dir = Path("web/public/data")
    out_jpg = out_dir / "ortho.jpg"
    Image.fromarray(ortho).save(out_jpg, quality=88, optimize=True)
    print(f"wrote {out_jpg} ({ortho.shape[1]}x{ortho.shape[0]}, {out_jpg.stat().st_size // 1024} KB)")

    # Update terrain.bin with quantized aerial-cross-referenced ground colours so gzip stays compact (~450 KB)
    step = 4
    h = np.round(ndimage.uniform_filter(g.astype(np.float32), step)[::step, ::step] * 10).astype(np.uint16)
    c = np.ascontiguousarray((ortho // 16) * 16, dtype=np.uint8)
    terrain_out = out_dir / "terrain.bin"
    with gzip.GzipFile(terrain_out, "wb", compresslevel=9, mtime=0) as fh:
        fh.write(h.tobytes())
        fh.write(c.tobytes())
    print(f"wrote {terrain_out} ({h.shape}, {terrain_out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
