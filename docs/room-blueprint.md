# Room Blueprint

`public/assets/layout/room-blueprint.json` defines the isometric floor blueprint used by `OfficeStage`.

## Goals

- Keep room tile/wall/furniture layout declarative.
- Compile blueprint data into render layers without changing component code.
- Validate bad blueprint input with explicit diagnostics.

## Schema (v1)

```json
{
  "version": 1,
  "tileMetrics": {
    "minGridCols": 4,
    "minGridRows": 3,
    "roomGridColStride": 58,
    "roomGridRowStride": 52,
    "tileHalfX": 16,
    "tileHalfY": 8,
    "originYOffset": 30,
    "wallTopYOffset": 18,
    "wallLeftYOffset": 8,
    "objectYOffset": 10
  },
  "occlusion": {
    "horizontalInset": 24,
    "topOffset": 14,
    "bottomRatio": 0.43
  },
  "rooms": [
    {
      "roomId": "ops",
      "generateFloor": true,
      "generateWalls": true,
      "base": {
        "floorTile": "floor_office",
        "wallTile": "wall_indoor",
        "furnitureTile": "bench",
        "doorTile": "door_open"
      },
      "anchors": [
        { "id": "ops-furniture-a", "kind": "furniture", "colRatio": 0.26, "rowRatio": 0.44 },
        { "id": "ops-door-left", "kind": "door", "edge": "left", "rowRatio": 0.52 }
      ]
    }
  ]
}
```

## Anchor Rules

- `kind`: `tile | wall | door | furniture`
- Grid anchors: use `col`/`row` or `colRatio`/`rowRatio`.
- Wall or door anchors: `edge` is required (`top` or `left`).
- Validation checks:
  - out-of-bounds anchor index
  - anchor collision in same room slot
  - empty room (`generateFloor=false`, `generateWalls=false`, and no anchors)

## Notes

- The current file migrates the 5 default rooms: `strategy`, `ops`, `build`, `spawn`, `lounge`.
- If the JSON is invalid or missing, compiler defaults are used and warnings are emitted.
