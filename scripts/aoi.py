"""Miami diorama, on the same grid convention as the Warsaw original.

The Warsaw map is anchored on the Palace spire and rotated 21.5°. Miami's
Brickell and Downtown grids already run nearly north-south, so this grid is
cardinal. It is anchored on Panorama Tower.

World coords: EPSG:6346, NAD83(2011) / UTM zone 17N, the CRS of the 2021
Miami-Dade lidar. x = easting, y = northing.
Grid coords: column i grows east, row j grows south. Cell (c, r) is 1 m.

The 2021 county flight covers 615 square miles of Miami-Dade, not Monroe
County and not the Everglades west of the developed county. This rectangle
is the Brickell and Downtown portion of that flight: south through south
Brickell, north past Freedom Tower, east across the bay to the MacArthur
Causeway. A wider rectangle (the Beach, Wynwood, the Gables) is the same
code with a larger W and D; his 1 m volume is a diorama, not the whole county.
"""
import math

import numpy as np

CITY = "miami"

# Panorama Tower, 1100 Brickell Bay Drive. EPSG:6346.
CX, CY = 581189.4, 2849694.2
THETA = 0.0
W, D = 4200, 3800
I0, J0 = 1200, 2100  # grid position of Panorama Tower
RAW = "data/raw"

EU = np.array([math.cos(THETA), math.sin(THETA)])   # grid +i in world
EV = np.array([math.sin(THETA), -math.cos(THETA)])  # grid +j in world


def to_grid(x, y):
    dx, dy = np.asarray(x) - CX, np.asarray(y) - CY
    return I0 + dx * EU[0] + dy * EU[1], J0 + dx * EV[0] + dy * EV[1]


def to_world(i, j):
    u, v = np.asarray(i) - I0, np.asarray(j) - J0
    return CX + u * EU[0] + v * EV[0], CY + u * EU[1] + v * EV[1]


def world_bounds(margin=0):
    xs, ys = to_world(np.array([0, W, W, 0]), np.array([0, 0, D, D]))
    return xs.min() - margin, ys.min() - margin, xs.max() + margin, ys.max() + margin
