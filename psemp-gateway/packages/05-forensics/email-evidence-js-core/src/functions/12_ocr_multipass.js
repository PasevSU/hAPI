import { invariant } from '../core/utils.js';
export function buildMultipassPlan({width,height,overlapRatio=0.04}) {
  invariant(width>0&&height>0,'width/height required'); invariant(overlapRatio>=0&&overlapRatio<0.25,'overlapRatio out of range');
  const ov=Math.round(height*overlapRatio);
  const crop=(id,y0,y1)=>({id,x:0,y:Math.max(0,y0),w:width,h:Math.min(height,y1)-Math.max(0,y0)});
  const half=Math.round(height/2), t1=Math.round(height/3), t2=Math.round(2*height/3);
  return [crop('A1',0,height),crop('B1',0,half+ov),crop('B2',half-ov,height),crop('C1',0,t1+ov),crop('C2',t1-ov,t2+ov),crop('C3',t2-ov,height)];
}
export function recordObservationSet(manifest, set) { const m=structuredClone(manifest); invariant(set.object_id&&Array.isArray(set.observations),'object_id and observations required'); m.ocr.observation_sets.push(set); return m; }
