import { clone, invariant } from '../core/utils.js';
export function attachIdentityLayer(manifest, {object_id,entity_id,entity_type='PERSON',match_basis=[],status='confirmed'}) {
  const m=clone(manifest); invariant(object_id&&entity_id,'object_id and entity_id required'); const obj=m.objects.find(o=>o.object_id===object_id); invariant(obj,`unknown object ${object_id}`);
  obj.identity={ui_color:'magenta',entity_id,entity_type,match_basis:[...match_basis],status}; return m;
}
