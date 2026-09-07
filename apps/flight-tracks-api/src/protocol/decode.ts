import {
  TRK1_FLAG_COLUMNAR,
  TRK1_FLIGHT_BYTES,
  TRK1_HEADER_BYTES,
  TRK1_MAGIC,
  TRK1_VERSION,
  type EncodedFlight,
  type TrackPayload,
} from "./types.js";

export function decodeTrackPayload(buf: Buffer): TrackPayload {
  if (buf.byteLength < TRK1_HEADER_BYTES) {
    throw new Error("buffer too short for TRK1 header");
  }

  let o = 0;
  const magic = buf.readUInt32LE(o); o += 4;
  if (magic !== TRK1_MAGIC) throw new Error(`bad magic 0x${magic.toString(16)}`);

  const version = buf.readUInt16LE(o); o += 2;
  if (version !== TRK1_VERSION) throw new Error(`unsupported version ${version}`);

  const flags = buf.readUInt16LE(o); o += 2;
  if ((flags & TRK1_FLAG_COLUMNAR) === 0) throw new Error("columnar flag required");

  const windowOrigin = buf.readDoubleLE(o); o += 8;
  const flightCount = buf.readUInt32LE(o); o += 4;
  const sampleCount = buf.readUInt32LE(o); o += 4;
  o += 8; // reserved

  const need =
    TRK1_HEADER_BYTES + flightCount * TRK1_FLIGHT_BYTES + sampleCount * 16;
  if (buf.byteLength < need) {
    throw new Error(`truncated payload: need ${need}, got ${buf.byteLength}`);
  }

  const flights: EncodedFlight[] = [];
  for (let i = 0; i < flightCount; i++) {
    const id = buf.readUInt32LE(o); o += 4;
    const sampleOffset = buf.readUInt32LE(o); o += 4;
    const sampleCountF = buf.readUInt32LE(o); o += 4;
    const tStart = buf.readFloatLE(o); o += 4;
    const tEnd = buf.readFloatLE(o); o += 4;
    o += 4; // reserved
    flights.push({ id, sampleOffset, sampleCount: sampleCountF, tStart, tEnd });
  }

  const time = new Float32Array(sampleCount);
  const lon = new Float32Array(sampleCount);
  const lat = new Float32Array(sampleCount);
  const alt = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) time[i] = buf.readFloatLE(o + i * 4);
  o += sampleCount * 4;
  for (let i = 0; i < sampleCount; i++) lon[i] = buf.readFloatLE(o + i * 4);
  o += sampleCount * 4;
  for (let i = 0; i < sampleCount; i++) lat[i] = buf.readFloatLE(o + i * 4);
  o += sampleCount * 4;
  for (let i = 0; i < sampleCount; i++) alt[i] = buf.readFloatLE(o + i * 4);

  return { windowOrigin, flights, time, lon, lat, alt };
}
