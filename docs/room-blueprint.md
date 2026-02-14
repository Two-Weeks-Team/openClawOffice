# Room Blueprint

`public/assets/layout/room-blueprint.json` defines the isometric floor blueprint used by `OfficeStage`.

## Goals

- Keep room tile/wall/furniture layout declarative.
- Compile blueprint data into render layers without changing component code.
- Keep tile layers explicit (`floor -> wall -> object`), while `entity -> overlay` stays in separate render passes.
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
        {
          "id": "ops-furniture-a",
          "kind": "furniture",
          "semantic": "desk_pair",
          "colRatio": 0.26,
          "rowRatio": 0.44
        },
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
- Furniture anchors can use `semantic` (`desk_pair`, `meeting_table`, `plant_small`, etc.).
- Validation checks:
  - out-of-bounds anchor index
  - anchor collision in same room slot
  - empty room (`generateFloor=false`, `generateWalls=false`, and no anchors)

## Semantic Mapping

- `OfficeStage` builds a semantic registry from `kenney-curation.json` and applies it before blueprint compile.
- Resolution order:
  - `anchor.tile` is already present: keep it as-is.
  - `anchor.semantic` is present: resolve semantic -> tile candidate.
  - furniture anchor without `tile`/`semantic`: apply room preset semantic sequence.
  - room preset not defined for `roomId`: use default preset `["desk_pair", "plant_small"]`.
  - unresolved/missing tile sprite at compile time: fallback to `base.furnitureTile`.
- Semantic diagnostics:
  - `SEMANTIC_KEY_UNKNOWN`: unknown semantic key string in anchor.
  - `SEMANTIC_TILE_UNRESOLVED`: semantic key had no resolvable tile in registry.

## Notes

- The current file migrates the 5 default rooms: `strategy`, `ops`, `build`, `spawn`, `lounge`.
- If the JSON is invalid or missing, compiler defaults are used and warnings are emitted.
