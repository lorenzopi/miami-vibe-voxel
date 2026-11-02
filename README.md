# Miami in voxels

Brickell and Downtown in 1 m voxels. The streets and names come from OpenStreetMap. The roofs, trees, ground, and bridge decks come from the 2021 Miami-Dade lidar, flown 7–9 April 2021 and published by NOAA.

The rectangle runs from south Brickell, north past Freedom Tower, and east across the bay to the MacArthur Causeway. The 2021 flight covers 615 square miles of Miami-Dade. Key Largo and the Everglades west of the developed county were not in that scan. Roof color is the lidar class, not an aerial photograph.

```sh
sh scripts/build_miami.sh
cd web && npm install && npx vite
```

Then open the URL Vite prints.

## Data

- [2021 Miami-Dade ITD lidar](https://www.fisheries.noaa.gov/inport/item/76028), NOAA Office for Coastal Management. Public domain.
- [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors, ODbL.

The viewer and voxelizer started as a fork of [warsaw-vibe-voxel](https://github.com/stared/warsaw-vibe-voxel).
