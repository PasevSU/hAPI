import { clone, invariant, normalizeBBox } from '../core/utils.js';
export function recordCaptureProvenance(manifest, capture) {
  const m=clone(manifest); invariant(capture.object_id && capture.canonical_pixel_sha256 && capture.png_sha256, 'object_id and both hashes required');
  const obj=m.objects.find(o=>o.object_id===capture.object_id); invariant(obj, `unknown object ${capture.object_id}`);
  obj.capture={source_document_sha256:capture.source_document_sha256,source_page:capture.source_page,pdf_bbox:capture.pdf_bbox?normalizeBBox(capture.pdf_bbox):null,normalized_bbox:normalizeBBox(capture.normalized_bbox),raster_bbox:normalizeBBox(capture.raster_bbox),padding_px:capture.padding_px??0,width_px:capture.width_px,height_px:capture.height_px,canonical_pixel_sha256:capture.canonical_pixel_sha256,png_sha256:capture.png_sha256}; return m;
}
