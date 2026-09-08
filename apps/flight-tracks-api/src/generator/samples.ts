type Waypoint = {
    lon: number;
    lat: number;
};

type Sample = {
    t: number;
    lon: number;
    lat: number;
    alt: number;
};

type Segment = {
    from: Waypoint;
    to: Waypoint;
    length: number;
};

export function samplesAlongRoute(
    waypoints: Waypoint[],
    tStart: number,
    tEnd: number,
    alt: number,
    dt = 0.2,
): Sample[] {
    if (waypoints.length < 2) {
        return [{ t: tStart, lon: waypoints[0].lon, lat: waypoints[0].lat, alt }];
    }

    const segments: Segment[] = [];
    let totalLength = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
        const length = dist(waypoints[i], waypoints[i + 1]);
        segments.push({ from: waypoints[i], to: waypoints[i + 1], length });
        totalLength += length;
    }

    if (totalLength === 0) {
        return [{ t: tStart, lon: waypoints[0].lon, lat: waypoints[0].lat, alt }];
    }

    const duration = tEnd - tStart;
    if(duration <= 0) {
        const position = placeAt(segments, 0);
        return [{ t: tStart, lon: position.lon, lat: position.lat, alt }];
    }

    const samples: Sample[] = [];

    for(let t = tStart; t < tEnd; t += dt) {
        const progressAlongTrip = (t - tStart) / duration;
        const distanceAlongRoute = progressAlongTrip * totalLength;
        const position = placeAt(segments, distanceAlongRoute);
        samples.push({ t, lon: position.lon, lat: position.lat, alt });
    }

    const end = placeAt(segments, totalLength);
    samples.push({ t: tEnd, lon: end.lon, lat: end.lat, alt });

    return samples;
}

function dist(from: Waypoint, to: Waypoint): number {
    const dLon = to.lon - from.lon;
    const dLat = to.lat - from.lat;
    return Math.hypot(dLon, dLat);
}

function placeAt(segments: Segment[], distanceAlongRoute: number): Waypoint {
    let remaining = distanceAlongRoute;

    for (const segment of segments) {
        if (remaining <= segment.length) {
            if (segment.length === 0) return segment.from;

            const progressAlongSegment = remaining / segment.length;
            return {
                lon: segment.from.lon + (segment.to.lon - segment.from.lon) * progressAlongSegment,
                lat: segment.from.lat + (segment.to.lat - segment.from.lat) * progressAlongSegment,
            };
        }
        remaining -= segment.length;
    }

    return segments[segments.length - 1].to;
}
