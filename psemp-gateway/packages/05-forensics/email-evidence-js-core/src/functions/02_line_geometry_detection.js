import { clone, normalizeBBox } from '../core/utils.js';
export function recordLineGeometry(manifest, lines) {
  const m=clone(manifest);
  m.geometry.lines = lines.map((x,i)=>({line_id:x.line_id??`LINE-${String(i+1).padStart(5,'0')}`, page:x.page, source:x.source??'detector', bbox:normalizeBBox(x.bbox), orientation:x.orientation??'unknown', confidence:x.confidence??null}));
  return m;
}
