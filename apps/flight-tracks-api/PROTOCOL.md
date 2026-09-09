# TRK1 — flight track binary protocol

Little-endian. Content-Type: `application/octet-stream`.

## Header (32 bytes)

| Offset | Type | Field |
|--------|------|--------|
| 0 | `u32` | `magic` = `0x31504B52` (`TRK1` as little-endian ASCII) |
| 4 | `u16` | `version` = `1` |
| 6 | `u16` | `flags` bit0 = columnar SoA (must be set) |
| 8 | `f64` | `windowOrigin` — Unix seconds; sample times are relative |
| 16 | `u32` | `flightCount` |
| 20 | `u32` | `sampleCount` |
| 24 | `u32` | `reserved0` = 0 |
| 28 | `u32` | `reserved1` = 0 |

## Flight table (`flightCount × 24` bytes)

Per flight, packed:

| Type | Field |
|------|--------|
| `u32` | `id` |
| `u32` | `sampleOffset` — index into sample columns |
| `u32` | `sampleCount` |
| `f32` | `tStart` — seconds since `windowOrigin` |
| `f32` | `tEnd` — seconds since `windowOrigin` |
| `u32` | `reserved` = 0 |

## Sample columns (columnar SoA)

Four `Float32Array`-compatible runs, each `sampleCount` values:

1. `time[sampleCount]` — seconds since `windowOrigin`
2. `lon[sampleCount]` — degrees
3. `lat[sampleCount]` — degrees
4. `alt[sampleCount]` — meters

Total sample payload = `sampleCount × 16` bytes.

## HTTP

- `GET /tracks?bbox=west,south,east,north&t0=&t1=&mode=phase0|full`
  - `t0` / `t1`: Unix seconds (absolute). Server converts to window-relative.
  - `mode=phase0`: denser near “now”, coarser ribbons (smaller bootstrap).
  - `mode=full`: uniform denser sampling for the requested range.
- `GET /flights/:id/track?t0=&t1=` — dense ~5 Hz for one flight.
- Chaos query overrides: `delayMs`, `jitterMs`, `errorRate`, `slowBody`, `truncate`, `corrupt` (see README).
