import { assertUniqueObjectId, clone } from '../core/utils.js';
export function addYellowShapeObject(manifest, object, {profileMode='apply'}={}) {
  assertUniqueObjectId(manifest, object.object_id);
  const m=clone(manifest);
  m.objects.push({object_id:object.object_id,machine_type:'recognition.shape',ui_color:'yellow',role:object.role??'IMAGE',page:object.page,search_zone_id:object.search_zone_id??null,ocr_policy:{run:profileMode==='learn',persist_text:false},capture_policy:{persist:true},recognition:{enabled:true,mode:'shape',descriptor:object.descriptor??null,canonical_pixel_sha256:object.canonical_pixel_sha256??null,perceptual_fingerprint:object.perceptual_fingerprint??null},semantic:null,hash_policy:{include_text:false}}); return m;
}
