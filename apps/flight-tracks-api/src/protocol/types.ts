/** TRK1 protocol constants and shared types. */

export const TRK1_MAGIC = 0x31504b52; // 'TRK1' LE
export const TRK1_VERSION = 1;
export const TRK1_FLAG_COLUMNAR = 1;
export const TRK1_HEADER_BYTES = 32;
export const TRK1_FLIGHT_BYTES = 24;
export const TRK1_SAMPLE_STRIDE = 16; // 4 × f32

export type SampleMode = "phase0" | "full" | "dense";

export interface FlightMeta {
  id: number;
  callsign: string;
  /** Absolute Unix seconds */
  tStartAbs: number;
  tEndAbs: number;
  /** Waypoints along the route (lon, lat) used to synthesize samples */
  waypoints: Array<{ lon: number; lat: number }>;
  cruiseAltM: number;
  /** Ground speed m/s for timing along route */
  speedMps: number;
}

export interface TrackQuery {
  west: number;
  south: number;
  east: number;
  north: number;
  /** Absolute Unix seconds */
  t0: number;
  t1: number;
  mode: SampleMode;
}

export interface EncodedFlight {
  id: number;
  sampleOffset: number;
  sampleCount: number;
  tStart: number;
  tEnd: number;
}

export interface TrackPayload {
  windowOrigin: number;
  flights: EncodedFlight[];
  time: Float32Array;
  lon: Float32Array;
  lat: Float32Array;
  alt: Float32Array;
}
