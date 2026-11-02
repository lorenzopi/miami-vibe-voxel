#!/bin/sh
# Miami diorama: 2021 county lidar + OSM, then the same voxelize step as Warsaw.
set -e
cd "$(dirname "$0")/.."
PYTHONPATH=scripts uv run python scripts/fetch_miami_lidar.py
sh scripts/fetch_miami_osm.sh
PYTHONPATH=scripts uv run python scripts/voxelize.py
