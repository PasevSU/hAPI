import { assertUniqueObjectId, clone, invariant } from '../core/utils.js';
export function addGreenSemanticObject(manifest, object) {
  const m=clone(manifest); invariant(object.object_id && object.role, 'object_id and role required');
  assertUniqueObjectId(manifest, object.object_id);
  m.objects.push({object_id:object.object_id,machine_type:'semantic.text',ui_color:'green',role:object.role,page:object.page,search_zone_id:object.search_zone_id??null,ocr_policy:{run:true,persist_text:true},capture_policy:{persist:true},recognition:{enabled:true,descriptor:object.descriptor??null},semantic:{persist:true,role:object.role},hash_policy:{include_text:object.include_text!==false}}); return m;
}
