import { invariant } from '../core/utils.js';
export function addProvenanceNode(manifest,node){const m=structuredClone(manifest);invariant(node.id&&node.type,'node id/type required');if(!m.provenance.nodes.some(n=>n.id===node.id))m.provenance.nodes.push(node);return m;}
export function addProvenanceEdge(manifest,edge){const m=structuredClone(manifest);invariant(edge.from&&edge.to&&edge.relation,'edge from/to/relation required');m.provenance.edges.push(edge);return m;}
export function reconstructPath(manifest,from,to){const q=[[from]],seen=new Set([from]);while(q.length){const path=q.shift(),last=path.at(-1);if(last===to)return path;for(const e of manifest.provenance.edges.filter(e=>e.from===last)){if(!seen.has(e.to)){seen.add(e.to);q.push([...path,e.to]);}}}return null;}
