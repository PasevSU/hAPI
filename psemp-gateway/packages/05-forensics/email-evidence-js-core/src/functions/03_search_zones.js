import { clone, invariant, normalizeBBox } from '../core/utils.js';
export function addSearchZone(manifest, zone) {
  const m=clone(manifest); invariant(zone.zone_id && zone.machine_type, 'zone_id and machine_type required');
  m.geometry.search_zones.push({zone_id:zone.zone_id,page:zone.page,bbox:normalizeBBox(zone.bbox),machine_type:zone.machine_type,required:zone.required!==false,profile_id:zone.profile_id??null}); return m;
}
