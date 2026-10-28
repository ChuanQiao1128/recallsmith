"""Inactive v4 development adapter over the existing local BGE/pgvector runtime.

This is not registered with authoring/MCP. It emits diagnostic packets, not the
frozen envelope/Plan/Profile required to authorize v4 evaluation or publication.
"""
from __future__ import annotations

import math

from pipeline import (EvidenceIndex, QUERY_PREFIX, canonical, digest, final_profile,
                      literal, load, sql, vector_text, verified_corpus, verify_source_chunk)
from retrieval_v4 import StructuralIndex, pack, plan_query


class DevelopmentEvidenceIndexV4:
    def __init__(self, root, model_cache, container):
        manifest, chunks = verified_corpus(root)
        # Reuse the existing offline model/index loader without reading or changing
        # the active profile. v3 filtering/query normalization is never called here.
        self.base = EvidenceIndex(root, model_cache, container,
                                  profile=final_profile(manifest['corpusVersion'], 'vector'))
        sources = {sid: load(root / 'corpus/sources' / (sid + '.json'))
                   for sid in {chunk['sourceId'] for chunk in chunks}}
        for chunk in chunks:
            verify_source_chunk(root, chunk)
        self.structural = StructuralIndex(sources, chunks)
        self.map_hash = digest(canonical(self.structural.map()))

    def _vector_queue(self, query):
        vector = next(iter(self.base.model.embed([QUERY_PREFIX + query])))
        rows = sql(self.base.container,
                   'SELECT chunk_id,1-(embedding <=> ' + literal(vector_text(vector)) + '::vector) '
                   'FROM official_chunks WHERE corpus_version=' +
                   literal(self.base.manifest['corpusVersion']) +
                   ' ORDER BY embedding <=> ' + literal(vector_text(vector)) +
                   '::vector,chunk_id LIMIT 40;')
        queue, seen = [], set()
        for row in rows.splitlines():
            fields = row.split('|')
            if len(fields) != 2:
                raise ValueError('Malformed pgvector candidate row')
            cid, score = fields[0], float(fields[1])
            if cid in seen or cid not in self.structural.chunks or not math.isfinite(score):
                raise ValueError('Invalid original pgvector candidate')
            seen.add(cid)
            queue.append({'chunkId': cid, 'score': score})
        if len(queue) > 40 or not queue:
            raise ValueError('Missing or oversized original pgvector candidate pool')
        return queue

    def retrieve(self, query, configuration):
        if configuration not in ('A', 'B'):
            raise ValueError('Only the two frozen configurations A and B are supported')
        plan = plan_query(query)
        queues = [self._vector_queue(form['text']) for form in plan['forms']]
        selected, trace = pack(queues, self.structural, 1 if configuration == 'A' else 2)
        packet = {'query': query, 'corpusVersion': self.base.manifest['corpusVersion'],
                  'configuration': configuration, 'retrievalConfigVersion': 4,
                  'mapHash': self.map_hash, 'plan': plan, 'candidateQueues': queues,
                  'evidence': selected, 'trace': trace,
                  'status': 'development_only_not_semantically_validated',
                  'releaseAuthorized': False}
        packet['evidenceHash'] = digest(canonical(packet))
        return packet
