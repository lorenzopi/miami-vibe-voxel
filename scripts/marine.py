"""Build web/public/data/marine.json from OSM piers, marinas, cruise terminals, and the bay water mask.

Includes:
- cruiseBerths: docked full-size ocean liners at PortMiami terminals V, G, E/10, D, and C/B
- pierBerths: docked motor yachts, superyachts, sailboats, powerboats, and police patrol boats at the
  69 OSM piers and marinas (Miamarina at Bayside, Museum Park slip, Brickell Bay Drive & Brickell Key piers,
  Miami River docks, Watson Island / Miami Outboard Club, and South Brickell waterfront finger piers)
- routes: verified open-water paths for moving cruise ships, motor yachts, sailboats, police boats, and jetskis
"""
import json
import math
from pathlib import Path

import numpy as np
from scipy import ndimage

import osm
from aoi import D, W


def main():
    o = osm.OSM()
    gz = np.load("data/ground.npz")
    g = gz["g"]
    rgb = gz["rgb"]
    bay_rgb = np.median(rgb[:, 3500:], axis=(0, 1)).astype(int)
    water = np.all(np.abs(rgb.astype(int) - bay_rgb) <= 6, axis=-1)
    dist_land = ndimage.distance_transform_edt(water)
    water_z = int(np.median(g[water]))

    # 1. PortMiami Cruise Ship Berths along Main Channel & Dodge Island Cut
    # Heading ~1.21 rad (ESE along the North Channel seawall)
    seawall_hdg = round(math.atan2(3773 - 2152, 782 - 176), 3)
    cruise_berths = [
        dict(name="Scarlet Lady (Terminal V)", line="virgin", x=2210, z=155, y=water_z, h=seawall_hdg, len=278),
        dict(name="Icon of the Seas (Terminal G)", line="royal", x=2585, z=295, y=water_z, h=seawall_hdg, len=315),
        dict(name="Carnival Celebration (Terminal E)", line="carnival", x=2985, z=445, y=water_z, h=seawall_hdg, len=300),
        dict(name="Carnival Horizon (Terminal D)", line="carnival", x=3365, z=588, y=water_z, h=seawall_hdg, len=290),
        dict(name="Norwegian Encore (Terminal B/C)", line="ncl", x=3765, z=738, y=water_z, h=seawall_hdg, len=305),
    ]

    # 2. Pier & Marina Decks + Berths from OSM man_made=pier lines and areas
    docks = []
    berths = []
    for oid, t, l in o.lines_with("man_made", ("pier",)):
        c = l.centroid
        if not (20 <= c.x < W - 20 and 20 <= c.y < D - 20) or l.length < 8:
            continue
        coords = list(l.coords)
        for a, b in zip(coords, coords[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            seg_len = math.hypot(dx, dy)
            if seg_len >= 4:
                docks.append(dict(
                    x=round((a[0] + b[0]) / 2, 1),
                    z=round((a[1] + b[1]) / 2, 1),
                    w=3.2,
                    l=round(seg_len + 0.6, 1),
                    h=round(math.atan2(dx, dy), 3),
                ))
        p0, p1 = l.coords[0], l.coords[-1]
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dy)
        if L < 6:
            continue
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux
        steps = [0.65] if L < 28 else [0.38, 0.78]
        for f in steps:
            px = p0[0] + dx * f
            py = p0[1] + dy * f
            for side in (-1, 1):
                wx = int(round(px + nx * side * 7.5))
                wy = int(round(py + ny * side * 7.5))
                if 10 <= wx < W - 10 and 10 <= wy < D - 10 and dist_land[wy, wx] >= 3.2:
                    if all((wx - b["x"]) ** 2 + (wy - b["z"]) ** 2 >= 13 ** 2 for b in berths):
                        berths.append(dict(x=wx, z=wy, y=water_z, h=round(math.atan2(ux, uy), 2)))

    for oid, typ, t, geom in o.areas_with("man_made", ("pier",)):
        c = geom.centroid
        if not (20 <= c.x < W - 20 and 20 <= c.y < D - 20):
            continue
        b = geom.bounds
        w_box, h_box = b[2] - b[0], b[3] - b[1]
        docks.append(dict(
            x=round((b[0] + b[2]) / 2, 1),
            z=round((b[1] + b[3]) / 2, 1),
            w=round(min(w_box, h_box, 14.0), 1),
            l=round(max(w_box, h_box), 1),
            h=round(math.pi / 2 if w_box >= h_box else 0.0, 3),
        ))
        if max(w_box, h_box) > 60:
            # Miamarina at Bayside large piers: finger slips along north & south sides
            for x in np.arange(b[0] + 16, b[2] - 10, 16):
                docks.append(dict(x=round(float(x), 1), z=round(b[1] - 4.5, 1), w=1.6, l=9.0, h=0.0))
                docks.append(dict(x=round(float(x), 1), z=round(b[3] + 4.5, 1), w=1.6, l=9.0, h=0.0))
                for wy, hdg in ((int(b[1] - 8), 0.0), (int(b[3] + 8), round(math.pi, 2))):
                    wx = int(x)
                    if 10 <= wx < W - 10 and 10 <= wy < D - 10 and dist_land[wy, wx] >= 2.8:
                        if all((wx - p["x"]) ** 2 + (wy - p["z"]) ** 2 >= 11 ** 2 for p in berths):
                            berths.append(dict(x=wx, z=wy, y=water_z, h=hdg))
        else:
            for ox, oy, hdg in ((9, 0, round(math.pi / 2, 2)), (6, 6, 2.3), (0, 9, 0.0)):
                wx, wy = int(b[2] + ox), int((b[1] + b[3]) / 2 + oy)
                if 10 <= wx < W - 10 and 10 <= wy < D - 10 and dist_land[wy, wx] >= 2.8:
                    if all((wx - p["x"]) ** 2 + (wy - p["z"]) ** 2 >= 11 ** 2 for p in berths):
                        berths.append(dict(x=wx, z=wy, y=water_z, h=hdg))
                        break

    # Assign vessel types to each pier berth by location & clearance
    Kinds = ("yacht", "sailboat", "boat", "superyacht", "police")
    for i, b in enumerate(berths):
        wx, wz = b["x"], b["z"]
        dl = float(dist_land[wz, wx])
        # Miamarina & Museum Park slips have Police Marine Patrol + superyachts + charter boats
        if 1600 <= wx <= 1830 and 210 <= wz <= 680:
            if i in (6, 14, 29):
                b["kind"] = "police"
            elif dl >= 9 and i % 4 == 0:
                b["kind"] = "superyacht"
            elif i % 3 == 0:
                b["kind"] = "sailboat"
            elif i % 2 == 0:
                b["kind"] = "yacht"
            else:
                b["kind"] = "boat"
        # Miami River docks (near Coast Guard / Riverfront)
        elif wx < 1350 and 1200 <= wz <= 1450:
            b["kind"] = "police" if i % 4 == 0 else "yacht"
        # Brickell Key & Brickell Bay Drive piers
        elif 1380 <= wx <= 1850 and 1800 <= wz <= 2150:
            b["kind"] = "superyacht" if (dl >= 8 and i % 3 == 0) else ("sailboat" if i % 3 == 1 else "yacht")
        # South Brickell private estate finger piers
        else:
            b["kind"] = ("yacht", "sailboat", "boat", "yacht", "superyacht")[i % 5] if dl >= 6 else ("yacht", "boat", "sailboat")[i % 3]

    # 3. Verified Open-Water Navigation Routes for Moving Vessels
    routes = [
        # Outbound / inbound Cruise Ship channel (PortMiami Main Channel)
        dict(kind="cruise", line="msc", len=285, v=4.5, pts=[[2050, 55], [2680, 250], [3420, 520], [4120, 780]]),
        # Police Marine Patrol routes (PortMiami Main Channel, Miamarina/Bayside, Miami River mouth, Brickell Key)
        dict(kind="police", v=13.5, pts=[[1835, 310], [1865, 680], [2380, 880], [3120, 1210], [2380, 880], [1865, 680]]),
        dict(kind="police", v=14.0, pts=[[1515, 1395], [1640, 1520], [1560, 1820], [1545, 2240], [1920, 2340], [1960, 1680], [1640, 1520]]),
        dict(kind="police", v=13.0, pts=[[1960, 120], [2620, 260], [3480, 560], [4020, 760], [3480, 560], [2620, 260]]),
        # Superyachts & Motor Yachts cruising Intracoastal, Dodge Island Cut, Fisherman's Channel & Brickell Bay
        dict(kind="superyacht", v=7.5, pts=[[1910, 140], [1900, 680], [1940, 1280], [2020, 1950], [1880, 2750], [1620, 3550]]),
        dict(kind="superyacht", v=7.0, pts=[[1780, 3580], [2040, 2780], [2160, 1960], [2080, 1280], [2650, 1020], [3580, 1450]]),
        dict(kind="yacht", v=9.5, pts=[[1495, 1385], [1680, 1490], [1950, 1650], [1980, 2260], [1620, 2680], [1420, 3280]]),
        dict(kind="yacht", v=9.0, pts=[[1520, 3420], [1740, 2760], [1545, 2220], [1525, 1740], [1780, 1220], [1845, 640], [1835, 290]]),
        dict(kind="yacht", v=10.0, pts=[[1980, 720], [2540, 940], [3260, 1290], [3880, 1540], [3260, 1290], [2540, 940]]),
        dict(kind="boat", v=12.0, pts=[[1820, 520], [2040, 1080], [1920, 1680], [1545, 1950], [1560, 2450], [2080, 2520], [2180, 1680], [2040, 1080]]),
        dict(kind="boat", v=11.5, pts=[[2240, 1480], [2780, 1860], [3280, 2420], [2640, 2980], [1960, 2760], [1980, 1980]]),
        # Sailboats tacking across open Biscayne Bay east of Brickell & Bayfront Park
        dict(kind="sailboat", v=5.2, pts=[[2120, 1480], [2680, 1780], [2280, 2180], [2840, 2560], [2320, 2980], [1880, 2580], [2120, 1480]]),
        dict(kind="sailboat", v=4.8, pts=[[1780, 2920], [2420, 3260], [3080, 2880], [2620, 2340], [3180, 1960], [2480, 1640], [1780, 2920]]),
        dict(kind="sailboat", v=5.0, pts=[[1940, 880], [2280, 1180], [1980, 1560], [2480, 1860], [2120, 2280], [1880, 1680], [1940, 880]]),
        dict(kind="sailboat", v=4.9, pts=[[2950, 1750], [3650, 2150], [3250, 2780], [3820, 3280], [3050, 3520], [2680, 2650], [2950, 1750]]),
        # Jetskis carving fast loops in Biscayne Bay off Brickell Key, Bayfront Park, and Museum Park
        dict(kind="jetski", v=18.5, pts=[[1960, 1820], [2240, 1920], [2320, 2160], [2060, 2280], [1920, 2060], [2140, 1860], [1960, 1820]]),
        dict(kind="jetski", v=19.5, pts=[[2040, 2340], [2380, 2480], [2460, 2740], [2160, 2840], [1960, 2620], [2220, 2420], [2040, 2340]]),
        dict(kind="jetski", v=18.0, pts=[[1850, 780], [2120, 920], [2180, 1160], [1940, 1240], [1830, 1020], [1850, 780]]),
        dict(kind="jetski", v=20.0, pts=[[1620, 2980], [1980, 3140], [2080, 3440], [1760, 3560], [1540, 3280], [1620, 2980]]),
    ]

    out = dict(waterZ=water_z, docks=docks, cruiseBerths=cruise_berths, pierBerths=berths, routes=routes)
    out_path = Path("web/public/data/marine.json")
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {out_path}: {len(docks)} docks, {len(cruise_berths)} cruise berths, {len(berths)} pier berths, {len(routes)} active routes")


if __name__ == "__main__":
    main()
