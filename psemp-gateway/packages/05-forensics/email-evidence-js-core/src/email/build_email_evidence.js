import { createManifest } from '../core/manifest.js';
import { parseEmlBytes } from './eml_parser.js';
import { sha256Stable } from '../core/utils.js';

export function buildEmailEvidence(bytes,{filename=null,evidenceId=null,maxEmailSizeMb=50,includeDecodedBody=true}={}) {
  if (!Number.isFinite(maxEmailSizeMb) || maxEmailSizeMb <= 0) throw new TypeError('maxEmailSizeMb must be a positive finite number.');
  if (bytes.length > maxEmailSizeMb * 1024 * 1024) throw new RangeError(`Email exceeds configured maximum of ${maxEmailSizeMb} MB.`);
  const parsed=parseEmlBytes(bytes,{filename}); const m=createManifest({sourceKind:'email/rfc822',evidenceId});
  m.source={kind:'email/rfc822',...parsed.source};
  m.email={
    envelope:parsed.envelope,
    message:parsed.message,
    thread:parsed.thread,
    transport:parsed.transport,
    authentication:parsed.authentication,
    headers:parsed.headers,
    mime:parsed.mime,
    content:parsed.content,
    attachments:parsed.attachments
  };
  m.provenance.nodes.push({id:'SOURCE-EML',type:'source.email',sha256:parsed.source.hashes.sha256,filename});
  parsed.transport.received.forEach((hop,i)=>{const id=`RECEIVED-${String(i+1).padStart(2,'0')}`;m.provenance.nodes.push({id,type:'email.transport_hop',hop});m.provenance.edges.push({from:'SOURCE-EML',to:id,relation:'contains_header_evidence'});});
  m.hashes.source=parsed.source.hashes;
  m.hashes.email_metadata_sha256=sha256Stable({message:parsed.message,thread:parsed.thread,transport:parsed.transport,authentication:parsed.authentication,mime_summary:{part_count:parsed.mime.part_count,text_part_count:parsed.mime.text_part_count,attachment_count:parsed.mime.attachment_count}});
  if (!includeDecodedBody) {
    m.email.content.decoded_text = null;
    m.email.thread.quoted = { messages: [], forwarded_markers: [] };
    const pending = [m.email.mime.root];
    while (pending.length) {
      const part = pending.pop();
      part.body = null;
      pending.push(...part.children);
    }
  }
  m.audit.events.push({type:'EML_PARSED',source_sha256:parsed.source.hashes.sha256,header_count:parsed.headers.ordered.length,received_hops:parsed.transport.hop_count,mime_parts:parsed.mime.part_count,decoded_body_included:includeDecodedBody});
  return m;
}
