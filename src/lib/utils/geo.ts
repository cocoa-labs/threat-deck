/** Convert lat/lon to 3D coordinates on a unit sphere */
export function latLonToVector3(
  lat: number,
  lon: number,
  radius: number = 1,
): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);

  return [x, y, z];
}

/** Calculate great circle distance between two points (km) */
export function greatCircleDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Generate points along a great circle arc for R3F curves */
export function greatCircleArc(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  segments: number = 50,
  altitude: number = 0.2,
): [number, number, number][] {
  const points: [number, number, number][] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Spherical interpolation
    const lat = lat1 + (lat2 - lat1) * t;
    const lon = lon1 + (lon2 - lon1) * t;
    // Arc height: parabolic curve peaking at midpoint
    const arcHeight = 1 + altitude * Math.sin(Math.PI * t);
    points.push(latLonToVector3(lat, lon, arcHeight));
  }

  return points;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Get current sun position for day/night terminator */
export function getSunPosition(): { lat: number; lon: number } {
  const now = new Date();
  const dayOfYear = getDayOfYear(now);
  const hourUTC = now.getUTCHours() + now.getUTCMinutes() / 60;

  // Solar declination (approximate)
  const declination = -23.45 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
  // Solar longitude
  const solarLon = -((hourUTC - 12) / 24) * 360;

  return { lat: declination, lon: solarLon };
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ─── Deterministic Seeded Offset ───

/** Deterministic hash-based jitter — same seed always produces same offset */
export function seededOffset(seed: string, range: number): { dLat: number; dLon: number } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const dLat = ((hash & 0xffff) / 0xffff - 0.5) * range;
  const dLon = (((hash >> 16) & 0xffff) / 0xffff - 0.5) * range;
  return { dLat, dLon };
}

// ─── Relative Timestamp ───

/** Format ISO timestamp as relative time (e.g. "2h ago") */
export function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Map Utilities ───

import type { IntelligenceCategory, Severity } from '@/lib/types';

/** Map Severity to hex color */
export function severityToHex(severity: Severity): string {
  const map: Record<Severity, string> = {
    critical: '#ff0040',
    high: '#ff4444',
    medium: '#ffaa00',
    low: '#00ff41',
    info: '#666666',
  };
  return map[severity];
}

/** Map IntelligenceCategory to hex color */
export function categoryToHex(category: IntelligenceCategory): string {
  const map: Record<IntelligenceCategory, string> = {
    conflict: '#ff0040',
    economic: '#ffaa00',
    technology: '#00ff41',
    policy: '#4488ff',
    proliferation: '#ff00ff',
    instability: '#ff4444',
    strategic: '#ff8800',
    market: '#44ff88',
    alternative: '#888888',
    // Cyber categories — distinct accents within the Matrix palette
    cve_critical: '#ff0040', // critical red
    cve_high: '#ff4444', // red-orange
    cve_medium: '#ffaa00', // amber
    ai_incident: '#00ffff', // electric cyan
    data_breach: '#ff00aa', // hot pink
    ransomware: '#ff0040', // critical red
    apt_activity: '#aa00ff', // violet
    zero_day: '#ff0080', // magenta
    ai_safety: '#00ffaa', // mint cyan
    model_release: '#88aaff', // soft blue
  };
  return map[category];
}
