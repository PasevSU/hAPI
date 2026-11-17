import { clone, invariant, setAt } from '../core/utils.js';
export function recordCanonicalRendering(manifest, rendering) {
  const m=clone(manifest);
  invariant(rendering && rendering.renderer && rendering.version, 'renderer and version required');
  invariant(Number.isFinite(rendering.dpi) && rendering.dpi>0, 'dpi required');
  invariant(Array.isArray(rendering.pages), 'pages array required');
  for (const p of rendering.pages) {
    invariant(Number.isInteger(p.page) && p.page>=1, 'page number required');
    invariant(p.pixel_sha256 && p.width>0 && p.height>0, 'page canonical pixel metadata required');
  }
  setAt(m,['rendering','canonical'],rendering);
  return m;
}
