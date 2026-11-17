export function resolveCluster(cluster) {
  const groups=new Map(); for(const m of cluster.members){const k=String(m.text??'').normalize('NFC');const g=groups.get(k)??{text:k,count:0,confidence_sum:0,observations:[]};g.count++;g.confidence_sum+=Number(m.confidence??0);g.observations.push(m.observation_id);groups.set(k,g);}
  const candidates=[...groups.values()].map(g=>({...g,mean_confidence:g.count?g.confidence_sum/g.count:0})).sort((a,b)=>b.count-a.count||b.mean_confidence-a.mean_confidence||a.text.localeCompare(b.text));
  return {...cluster,consensus:candidates[0]?.text??'',status:candidates.length>1?'DISAGREEMENT':'AGREEMENT',candidates};
}
export function recordDisagreements(manifest,resolvedClusters){const m=structuredClone(manifest);m.ocr.word_clusters=resolvedClusters;m.ocr.disagreements=resolvedClusters.filter(x=>x.status==='DISAGREEMENT').map(x=>({cluster_id:x.cluster_id,candidates:x.candidates}));return m;}
