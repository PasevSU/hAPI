export function createManifest({sourceKind='unknown', evidenceId=null}={}) {
  return {
    schema_version: '0.1.0',
    evidence_id: evidenceId,
    source: { kind: sourceKind },
    email: null,
    rendering: {},
    geometry: { lines: [], search_zones: [], object_boundaries: [] },
    objects: [],
    ocr: { observation_sets: [], word_clusters: [], disagreements: [] },
    profiles: { document: [], identity: [] },
    hash_selection: { selections: [] },
    hashes: {},
    anonymization: { policies: [], preview: [], redaction_plans: [] },
    provenance: { nodes: [], edges: [] },
    audit: { events: [], warnings: [], release_gate: 'NOT_VERIFIED' }
  };
}
