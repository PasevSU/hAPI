import { normalizeBBox } from '../core/utils.js';
export function remapBBox(localBBox, crop) { const b=normalizeBBox(localBBox); return {x:b.x+crop.x,y:b.y+crop.y,w:b.w,h:b.h}; }
export function rasterToNormalized(bbox,width,height){const b=normalizeBBox(bbox);return {x:b.x/width,y:b.y/height,w:b.w/width,h:b.h/height};}
