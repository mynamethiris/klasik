// Koordinat sekolah
export const SCHOOL_LAT = -6.3526;
export const SCHOOL_LON = 107.181702;
export const MAX_DISTANCE_METERS = 100;

export function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius bumi dalam km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1000; // Jarak dalam meter
}

export function getCurrentWIBTime() {
  const now = new Date();
  return now.toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function getStatus(time: string) {
  // Batas telat 06:30
  return time > "06:30" ? "Telat" : "Tepat Waktu";
}
