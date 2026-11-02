#!/bin/sh
# OSM for the Miami diorama, same JSON shape as the Warsaw fetch.
# The rectangle is a few kilometres, small enough for the public Overpass servers.
set -e
cd "$(dirname "$0")/.."
mkdir -p data/raw
BB=$(PYTHONPATH=scripts uv run python -c "
from pyproj import Transformer
from aoi import world_bounds
t = Transformer.from_crs(6346, 4326, always_xy=True)
x0, y0, x1, y1 = world_bounds(80)
p = [t.transform(x, y) for x in (x0, x1) for y in (y0, y1)]
print('%.5f,%.5f,%.5f,%.5f' % (min(q[1] for q in p), min(q[0] for q in p), max(q[1] for q in p), max(q[0] for q in p)))
")
echo "bbox $BB"
Q="[out:json][timeout:240];nwr($BB);out body geom;"
for round in 1 2 3 4; do
  for u in https://overpass-api.de/api/interpreter https://overpass.kumi.systems/api/interpreter; do
    curl -sS -m 300 -A "miami-vibe-voxel/0.1" --data-urlencode "data=$Q" "$u" -o data/raw/osm.json.part
    if head -c 40 data/raw/osm.json.part | grep -q '{'; then
      mv data/raw/osm.json.part data/raw/osm.json
      echo "OK $u"
      exit 0
    fi
    echo "fail $u (round $round)"
    sleep $((round * 8))
  done
done
exit 1
