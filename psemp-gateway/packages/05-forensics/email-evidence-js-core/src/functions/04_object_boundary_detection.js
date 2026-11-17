import { clone, invariant, normalizeBBox } from '../core/utils.js';
export function recordObjectBoundary(manifest, boundary) {
  const m=clone(manifest); invariant(boundary.object_id && boundary.zone_id, 'object_id and zone_id required');
  m.geometry.object_boundaries.push({object_id:boundary.object_id,zone_id:boundary.zone_id,page:boundary.page,bbox:normalizeBBox(boundary.bbox),detector:boundary.detector??null,confidence:boundary.confidence??null}); return m;
}
