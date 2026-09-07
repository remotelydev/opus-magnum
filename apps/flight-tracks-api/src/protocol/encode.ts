import {
  TRK1_FLAG_COLUMNAR,
  TRK1_FLIGHT_BYTES,
  TRK1_HEADER_BYTES,
  TRK1_MAGIC,
  TRK1_VERSION,
  type TrackPayload,
} from "./types.js";

export function encodeTrackPayload(payload: TrackPayload): Buffer {
  const { windowOrigin, flights, time, lon, lat, alt } = payload;
  const sampleCount = time.length;
  if (lon.length !== sampleCount || lat.length !== sampleCount || alt.length !== sampleCount) {
    throw new Error("SoA column length mismatch");
  }

  const flightCount = flights.length;
  const total =
    TRK1_HEADER_BYTES +
    flightCount * TRK1_FLIGHT_BYTES +
    sampleCount * 16;

  const buf = Buffer.allocUnsafe(total);
  let o = 0;

  buf.writeUInt32LE(TRK1_MAGIC, o); o += 4;
  buf.writeUInt16LE(TRK1_VERSION, o); o += 2;
  buf.writeUInt16LE(TRK1_FLAG_COLUMNAR, o); o += 2;
  buf.writeDoubleLE(windowOrigin, o); o += 8;
  buf.writeUInt32LE(flightCount, o); o += 4;
  buf.writeUInt32LE(sampleCount, o); o += 4;
  buf.writeUInt32LE(0, o); o += 4;
  buf.writeUInt32LE(0, o); o += 4;

  for (const f of flights) {
    buf.writeUInt32LE(f.id, o); o += 4;
    buf.writeUInt32LE(f.sampleOffset, o); o += 4;
    buf.writeUInt32LE(f.sampleCount, o); o += 4;
    buf.writeFloatLE(f.tStart, o); o += 4;
    buf.writeFloatLE(f.tEnd, o); o += 4;
    buf.writeUInt32LE(0, o); o += 4;
  }

  for (let i = 0; i < sampleCount; i++) buf.writeFloatLE(time[i]!, o + i * 4);
  o += sampleCount * 4;
  for (let i = 0; i < sampleCount; i++) buf.writeFloatLE(lon[i]!, o + i * 4);
  o += sampleCount * 4;
  for (let i = 0; i < sampleCount; i++) buf.writeFloatLE(lat[i]!, o + i * 4);
  o += sampleCount * 4;
  for (let i = 0; i < sampleCount; i++) buf.writeFloatLE(alt[i]!, o + i * 4);

  return buf;
}
