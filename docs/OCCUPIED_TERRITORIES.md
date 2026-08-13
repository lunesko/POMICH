# Temporarily occupied territories (product guardrails)

POMICH treats certain areas as unavailable for orders, directory POIs, and map point selection. This follows the **de-jure Ukrainian government view** and commonly used OSINT contact-line data — not a political endorsement.

## Visual overlay (map)

- GeoJSON: `public/geo/occupied-territories.geojson` (from [DeepState Map data](https://github.com/cyterat/deepstate-map-data))
- Rendered as red semi-transparent polygons with dashed border when `showUkraineMask` is enabled on `RouteMap`

## Logic guardrails (always active)

Simplified bounding boxes in:

- Backend: `bot/occupied_territories.py`
- Frontend: `src/lib/occupiedTerritories.ts`

| Zone ID | Approximate area |
|---------|------------------|
| `crimea` | Autonomous Republic of Crimea + Sevastopol |
| `donetsk-occupied` | Eastern Donetsk oblast (east of contact line) |
| `luhansk-occupied` | Eastern Luhansk oblast |
| `zaporizhzhia-occupied-south` | Southern Zaporizhzhia (Melitopol/Berdyansk axis) |
| `kherson-occupied-east-bank` | East bank Kherson oblast + south |

Government-controlled cities (e.g. Zaporizhzhia city, Kherson west bank) remain **available** — bboxes are conservative, not whole oblasts.

## Where enforced

- `POST /api/orders` — rejects pickup/destination in occupied bboxes
- `GET /api/map/providers` — filters directory pins in occupied areas
- OSM directory import — skips POIs in occupied bboxes
- `RouteMap` — blocks click/drag to occupied points during order location pick

## Updating

1. Refresh DeepState GeoJSON for map visuals (see `data/geo/README.md`)
2. Adjust bboxes in Python + TypeScript if contact line shifts significantly
