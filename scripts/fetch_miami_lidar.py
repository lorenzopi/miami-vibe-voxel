"""Sample the 2021 Miami-Dade lidar into the diorama grid.

The county cloud is about 80 billion points. This reads only the Entwine
nodes over the Brickell / Downtown rectangle, at about 0.6 m spacing, and
writes the rasters voxelize.py expects:

  dsm  0.5 m  max height, noise classes dropped
  dtm  1 m    mean of ground points (class 2)
  orto 0.2 m  colour from the lidar class (building, tree, water, ground)

Source: Miami-Dade ITD lidar, flown 7-9 April 2021, redistributed by NOAA
Office for Coastal Management. Public domain.
https://www.fisheries.noaa.gov/inport/item/76028
"""
import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import laspy
import numpy as np
from PIL import Image
from scipy import ndimage

from aoi import D, RAW, W, to_grid, world_bounds

EPT = "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/entwine/geoid18/10338/"
UA = {"User-Agent": "miami-vibe-voxel/0.1 (personal diorama; NOAA public-domain lidar)"}
# Cube from ept.json. Depth 10 nodes are ~73 m across; their points are ~0.6 m apart.
ROOT = (513355.0, 2803488.0, -37227.0, 588389.0, 2878522.0, 37807.0)
DEPTH = 10
NOISE = {7, 18}
GROUND = 2
# Painted into the orthophoto slot. There is no 5 cm aerial photo in this build.
CLASS_RGB = {
    6: (186, 176, 164),   # building
    17: (150, 148, 144),  # bridge deck
    5: (46, 120, 64),    # high vegetation
    4: (78, 150, 78),    # medium vegetation
    3: (140, 168, 96),   # low vegetation
    9: (36, 110, 168),   # bay: more blue than green, so it is not read as grass
    2: (196, 186, 164),  # ground
}
PRIO = {6: 70, 17: 60, 5: 50, 4: 40, 3: 30, 9: 20, 2: 10}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def node_bounds(depth, x, y, z):
    n = 2 ** depth
    sx = (ROOT[3] - ROOT[0]) / n
    sy = (ROOT[4] - ROOT[1]) / n
    sz = (ROOT[5] - ROOT[2]) / n
    return (ROOT[0] + x * sx, ROOT[1] + y * sy, ROOT[2] + z * sz,
            ROOT[0] + (x + 1) * sx, ROOT[1] + (y + 1) * sy, ROOT[2] + (z + 1) * sz)


def intersects(bounds, box):
    return not (bounds[3] < box[0] or bounds[0] > box[2] or bounds[4] < box[1] or bounds[1] > box[3])


def fetch_naip_ortho():
    """Fetch 1 m USGS NAIP aerial orthophoto over the AOI in EPSG:6346 (cached in data/raw/naip_1m.png)."""
    cache = Path(RAW) / "naip_1m.png"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        im = Image.open(cache).convert("RGB")
        if im.size == (W, D):
            return np.asarray(im, dtype=np.uint8)
    x0, y0, x1, y1 = world_bounds()
    xm = (x0 + x1) / 2
    w0 = W // 2
    w1 = W - w0
    base = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
    halves = []
    for xa, xb, wi in ((x0, xm, w0), (xm, x1, w1)):
        url = f"{base}?bbox={xa},{y0},{xb},{y1}&bboxSR=6346&imageSR=6346&size={wi},{D}&format=jpg&f=image"
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=90) as resp:
            im = Image.open(io.BytesIO(resp.read())).convert("RGB")
        if im.size != (wi, D):
            im = im.resize((wi, D), Image.Resampling.BILINEAR)
        halves.append(np.asarray(im, dtype=np.uint8))
    arr = np.concatenate(halves, axis=1)
    Image.fromarray(arr).save(cache)
    return arr


def select_nodes():
    """Depth-10 nodes whose XY footprint meets the diorama and whose Z can hold a building."""
    box = world_bounds(margin=30)
    root = get_json(EPT + "ept-hierarchy/0-0-0-0.json")
    parents = []
    for key, count in root.items():
        if count >= 0 or not key.startswith("8-"):
            continue
        _, x, y, z = (int(p) for p in key.split("-"))
        if intersects(node_bounds(8, x, y, z), box):
            parents.append(key)
    print(f"hierarchy files over the diorama: {len(parents)}", flush=True)
    wanted = []
    for key in parents:
        listing = get_json(EPT + f"ept-hierarchy/{key}.json")
        for child, count in listing.items():
            if count <= 0 or not child.startswith(f"{DEPTH}-"):
                continue
            _, x, y, z = (int(p) for p in child.split("-"))
            if z < 507 or z > 513:
                continue
            if intersects(node_bounds(DEPTH, x, y, z), box):
                wanted.append(child)
    return wanted


def fetch_laz(key):
    path = Path(RAW) / "ept" / f"{key}.laz"
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    req = urllib.request.Request(EPT + f"ept-data/{key}.laz", headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            tmp.write_bytes(resp.read())
        tmp.rename(path)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise
    return path


def main():
    keys = select_nodes()
    print(f"lidar nodes: {len(keys)}", flush=True)
    dsm = np.full((D * 2, W * 2), -np.inf, np.float32)
    gsum = np.zeros((D, W), np.float64)
    gcnt = np.zeros((D, W), np.uint16)
    wsum = np.zeros((D, W), np.float64)
    wcnt = np.zeros((D, W), np.uint16)
    klass = np.zeros((D, W), np.uint8)
    intense = np.zeros((D, W), np.uint16)

    done = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = {pool.submit(fetch_laz, key): key for key in keys}
        for fut in as_completed(futs):
            path = fut.result()
            las = laspy.read(path)
            x = np.asarray(las.x)
            y = np.asarray(las.y)
            z = np.asarray(las.z, dtype=np.float32)
            cls = np.asarray(las.classification)
            ii, jj = to_grid(x, y)
            # 0.5 m surface
            c = np.floor(ii * 2).astype(np.int32)
            r = np.floor(jj * 2).astype(np.int32)
            keep = (c >= 0) & (r >= 0) & (c < W * 2) & (r < D * 2) & ~np.isin(cls, list(NOISE))
            if keep.any():
                np.maximum.at(dsm, (r[keep], c[keep]), z[keep])
            # 1 m ground and colour
            c1 = np.floor(ii).astype(np.int32)
            r1 = np.floor(jj).astype(np.int32)
            inside = (c1 >= 0) & (r1 >= 0) & (c1 < W) & (r1 < D)
            ground = inside & (cls == GROUND)
            if ground.any():
                np.add.at(gsum, (r1[ground], c1[ground]), z[ground])
                np.add.at(gcnt, (r1[ground], c1[ground]), 1)
            wet = inside & (cls == 9)
            if wet.any():
                np.add.at(wsum, (r1[wet], c1[wet]), z[wet])
                np.add.at(wcnt, (r1[wet], c1[wet]), 1)
            sel = np.flatnonzero(inside)
            if len(sel):
                rr, cc = r1[sel], c1[sel]
                codes = cls[sel]
                bright = np.asarray(las.intensity)[sel] if "intensity" in las.point_format.dimension_names else None
                for code, prio in PRIO.items():
                    better = (codes == code) & (prio > klass[rr, cc])
                    if not better.any():
                        continue
                    klass[rr[better], cc[better]] = prio
                    if bright is not None:
                        intense[rr[better], cc[better]] = bright[better]
            done += 1
            if done % 100 == 0 or done == len(keys):
                print(f"  binned {done}/{len(keys)}", flush=True)

    dtm = np.divide(gsum, gcnt, out=np.full((D, W), np.nan, np.float32), where=gcnt > 0)
    holes = ~np.isfinite(dtm)
    if holes.any() and (~holes).any():
        _, (rr, cc) = ndimage.distance_transform_edt(holes, return_indices=True)
        dtm[holes] = dtm[rr[holes], cc[holes]]
    dtm = dtm.astype(np.float32)

    # Class 9 is water. Open water often has no return at all, so grow that
    # mask into empty cells, then one level for the whole bay. A bumpy max
    # of water returns is what made the surface look like litter.
    water = klass == PRIO[9]
    empty = klass == 0
    grow = water.copy()
    for _ in range(6):
        dil = grow.copy()
        dil[1:] |= grow[:-1]
        dil[:-1] |= grow[1:]
        dil[:, 1:] |= grow[:, :-1]
        dil[:, :-1] |= grow[:, 1:]
        grow |= dil & empty
    claimed = np.isin(klass, [PRIO[c] for c in (6, 17, 5, 4, 3, 2)])
    water = (water | grow) & ~claimed
    have = wcnt > 0
    level = float(np.median(wsum[have] / wcnt[have])) if have.any() else 0.0
    dtm[water] = level
    print(f"bay level {level:.2f} m, water cells {int(water.sum())}", flush=True)

    dsm[~np.isfinite(dsm)] = np.nan
    missing = ~np.isfinite(dsm)
    ground_up = np.repeat(np.repeat(dtm, 2, 0), 2, 1)
    dsm[missing] = ground_up[missing]
    dsm[np.repeat(np.repeat(water, 2, 0), 2, 1)] = level
    # A scanned roof should not sit below the ground under it.
    dsm = np.maximum(dsm, ground_up).astype(np.float32)

    color = np.zeros((D, W, 3), np.uint8)
    color[:] = CLASS_RGB[2]
    for code, rgb in CLASS_RGB.items():
        color[klass == PRIO[code]] = rgb
    shade = np.clip(0.75 + intense.astype(np.float32) / 4000, 0.75, 1.15)[..., None]
    color = np.clip(color * shade, 0, 255).astype(np.uint8)
    try:
        naip = fetch_naip_ortho()
        print("naip ortho", naip.shape, flush=True)
        # Blend 75 % real NAIP aerial photo with 25 % lidar-class shade so roofs, parks, pools, and palm canopies
        # take their real Miami colors while keeping lidar return contrast.
        color = np.clip(naip.astype(np.float32) * 0.78 + color.astype(np.float32) * 0.22, 0, 255).astype(np.uint8)
        color[water] = CLASS_RGB[9]
    except Exception as exc:
        print(f"naip fallback to lidar class colors: {exc}", flush=True)
    orto = np.repeat(np.repeat(color, 5, 0), 5, 1)

    Path("data").mkdir(exist_ok=True)
    np.savez_compressed("data/prep.npz", dsm=dsm, dtm=dtm, orto=orto, water=water)
    print("prep", "dsm", dsm.shape, float(np.nanmin(dsm)), float(np.nanmax(dsm)),
          "dtm", float(dtm.min()), float(dtm.max()), "orto", orto.shape, flush=True)


if __name__ == "__main__":
    main()
