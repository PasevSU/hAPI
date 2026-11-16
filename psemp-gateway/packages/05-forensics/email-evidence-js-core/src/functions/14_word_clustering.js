import { bboxIoU, bboxCenter } from '../core/utils.js';
function norm(t){return String(t??'').normalize('NFC').trim().toLocaleLowerCase();}
export function clusterWords(observations,{iouThreshold=0.25,centerTolerance=0.03,pageWidth=1,pageHeight=1}={}){
  const words=[]; for(const obs of observations) for(const w of obs.words??[]) words.push({...w,observation_id:obs.id});
  const clusters=[];
  for(const w of words){let best=null,bestScore=-1;for(const c of clusters){const iou=bboxIoU(w.bbox,c.anchor_bbox);const a=bboxCenter(w.bbox),b=bboxCenter(c.anchor_bbox);const d=Math.hypot((a.x-b.x)/pageWidth,(a.y-b.y)/pageHeight);const textBonus=norm(w.text)===norm(c.members[0].text)?0.2:0;const score=iou+textBonus-d;if((iou>=iouThreshold||d<=centerTolerance)&&score>bestScore){best=c;bestScore=score;}} if(best) best.members.push(w); else clusters.push({cluster_id:`WC-${String(clusters.length+1).padStart(6,'0')}`,anchor_bbox:w.bbox,members:[w]});}
  return clusters;
}
