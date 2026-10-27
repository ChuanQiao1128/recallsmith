#!/usr/bin/env python3
"""Versioned, author-side AWS evidence retrieval. Model execution belongs to the .NET workbench."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / 'tools/ingest/src'), str(REPO / 'evals/src')]
MODEL = 'BAAI/bge-small-en-v1.5'
DIMENSION = 384
CHUNKING = {'version': 1, 'maxChars': 1500, 'overlapChars': 150}
ALLOWED_HOSTS = frozenset({'docs.aws.amazon.com', 'aws.amazon.com'})
QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '


def digest(value: bytes | str) -> str:
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def load(path: Path):
    return json.loads(path.read_text())


def save(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(temp, path)


def official_url(url: str) -> str:
    p = urlsplit(url)
    if p.scheme != 'https' or p.hostname not in ALLOWED_HOSTS or p.username or p.password or p.port:
        raise ValueError('Only approved public AWS HTTPS documentation URLs are accepted')
    return url


def parse_deck(path: Path) -> list[dict]:
    """Read the existing Q/A format; the console parser remains the import authority."""
    cards = []
    for block in re.split(r'^## ', path.read_text(), flags=re.M)[1:]:
        header, _, body = block.partition('\n')
        match = re.fullmatch(r'([a-z0-9][a-z0-9-]*)\s*\|\s*d([123])\s*', header)
        if not match:
            raise ValueError('Invalid card header')
        fields: dict[str, list[str]] = {}
        current = None
        for line in body.splitlines():
            marker = re.match(r'^(TOPIC|Q|Q_ZH|A|A_ZH|USAGE|USAGE_ZH|SOURCE):\s*(.*)$', line)
            if marker:
                current = marker[1]
                if current in fields:
                    raise ValueError('Duplicate section: ' + current)
                fields[current] = [marker[2]] if marker[2] else []
            elif current:
                fields[current].append(line)
        text = {k: '\n'.join(v).strip() for k, v in fields.items()}
        if not all(text.get(k) for k in ['Q', 'Q_ZH', 'A', 'A_ZH', 'SOURCE']):
            raise ValueError('Incomplete bilingual card ' + match[1])
        source_url, _, quote = text['SOURCE'].partition('\n')
        cards.append({'stableUid': match[1], 'difficulty': int(match[2]), 'oldOrder': len(cards) + 1,
                      'topic': text.get('TOPIC', ''), 'questionEn': text['Q'], 'questionZh': text['Q_ZH'],
                      'answerEn': text['A'], 'answerZh': text['A_ZH'],
                      'sourceUrl': official_url(source_url.strip()), 'sourceQuote': quote.strip()})
    if not cards or len({x['stableUid'] for x in cards}) != len(cards):
        raise ValueError('Empty deck or duplicate UID')
    return cards


def inventory(args) -> None:
    cards = parse_deck(args.deck)
    save(args.root / 'curriculum/existing-cards.json', {
        'sourceSha256': digest(args.deck.read_bytes()), 'sourceCount': len(cards), 'cards': cards})
    save(args.root / 'corpus/source-seeds.json', {'urls': sorted({c['sourceUrl'] for c in cards})})
    print(canonical({'cards': len(cards), 'officialUrls': len({c['sourceUrl'] for c in cards})}))


def fetch_one(url: str, directory: Path) -> dict:
    from dc_ingest.fetch import fetch_url
    from dc_ingest.extract import extract_html
    from dc_ingest.normalize import normalize_text
    from dc_ingest.chunking import chunk_text
    official_url(url)
    source_id = digest(url)
    path = directory / f'{source_id}.json'
    if path.exists():
        doc = load(path)
        if doc['url'] != url or doc['sourceVersion'] != digest(doc['text']):
            raise ValueError('Cached source integrity failure')
        return doc
    fetched = fetch_url(url)
    if fetched.kind != 'html':
        raise ValueError('The official corpus currently accepts HTML only')
    html = extract_html(fetched.body, fetched.charset)
    text = normalize_text(html.text)
    if len(text) < 150:
        raise ValueError('Insufficient official page content')
    doc = {'sourceId': source_id, 'sourceVersion': digest(text), 'url': url,
           'finalUrl': official_url(fetched.url), 'title': html.title, 'text': text,
           'rawSha256': digest(fetched.body), 'fetchedAt': dt.datetime.now(dt.UTC).isoformat()}
    doc['chunks'] = []
    for part in chunk_text(text, headings=True, max_chunk_chars=CHUNKING['maxChars'],
                           overlap_chars=CHUNKING['overlapChars']):
        if text[part['charStart']:part['charEnd']] != part['text']:
            raise ValueError('Chunk/source offset mismatch')
        chunk_id = digest(source_id + doc['sourceVersion'] + part['id'])[:32]
        doc['chunks'].append({**part, 'chunkId': chunk_id, 'evidenceId': 'ev-' + chunk_id,
                              'sourceId': source_id, 'sourceVersion': doc['sourceVersion'],
                              'url': url, 'title': doc['title'], 'textSha256': digest(part['text'])})
    save(path, doc)
    return doc


def fetch(args) -> None:
    seeds = load(args.seeds)['urls']
    if not seeds or len(seeds) != len(set(seeds)):
        raise ValueError('Unique nonempty source URL list required')
    os.environ['DC_INGEST_ALLOWED_HOSTS'] = ','.join(sorted(ALLOWED_HOSTS))
    directory = args.root / 'corpus/sources'
    directory.mkdir(parents=True, exist_ok=True)
    docs, failures = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_one, u, directory): u for u in seeds}
        for future in as_completed(futures):
            try:
                docs.append(future.result())
            except Exception as e:
                failures.append({'url': futures[future], 'error': str(e)})
            if (len(docs) + len(failures)) % 25 == 0:
                print(canonical({'fetched': len(docs), 'failed': len(failures)}), flush=True)
    docs.sort(key=lambda x: x['sourceId'])
    save(args.root / 'corpus/fetch-status.json', {'succeeded': len(docs), 'failures': failures})
    # Partial retrieval is useful, but cannot masquerade as a complete corpus.
    if failures:
        raise RuntimeError(f'{len(failures)} source fetches need explicit replacement/review; cached successes retained')
    chunks = [c for d in docs for c in d['chunks']]
    manifest = {'model': MODEL, 'dimension': DIMENSION, 'chunking': CHUNKING,
                'sources': [{k: d[k] for k in ['sourceId', 'sourceVersion', 'url', 'title', 'fetchedAt']}
                            for d in docs], 'sourceCount': len(docs), 'chunkCount': len(chunks)}
    manifest['corpusVersion'] = digest(canonical({'sources': [(d['sourceId'], d['sourceVersion']) for d in docs],
                                                'chunking': CHUNKING, 'embeddingModel': MODEL}))
    existing = args.root / 'corpus/manifest.json'
    if existing.exists() and load(existing)['corpusVersion'] != manifest['corpusVersion']:
        raise RuntimeError('A frozen corpus exists; use a new run/version directory rather than overwrite it')
    save(args.root / 'corpus/chunks.json', chunks)
    save(existing, manifest)
    print(canonical({'corpusVersion': manifest['corpusVersion'], 'sources': len(docs), 'chunks': len(chunks)}))


def sql(container: str, statement: str) -> str:
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
                             '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Local PostgreSQL operation failed: ' + result.stderr[:1200])
    return result.stdout.strip()


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def vector_text(vector) -> str:
    return '[' + ','.join(format(float(x), '.9g') for x in vector) + ']'


def verified_corpus(root: Path) -> tuple[dict, list[dict]]:
    manifest, chunks = load(root / 'corpus/manifest.json'), load(root / 'corpus/chunks.json')
    if manifest['model'] != MODEL or manifest['dimension'] != DIMENSION:
        raise ValueError('Incompatible embedding collection')
    versions = {s['sourceId']: s['sourceVersion'] for s in manifest['sources']}
    if len(chunks) != manifest['chunkCount'] or len({c['chunkId'] for c in chunks}) != len(chunks):
        raise ValueError('Corpus cardinality mismatch')
    for c in chunks:
        official_url(c['url'])
        if versions.get(c['sourceId']) != c['sourceVersion'] or digest(c['text']) != c['textSha256']:
            raise ValueError('Chunk integrity failure')
    return manifest, chunks


def embed(args) -> None:
    from fastembed import TextEmbedding
    import numpy as np
    manifest, chunks = verified_corpus(args.root)
    model = TextEmbedding(model_name=MODEL, cache_dir=str(args.model_cache), threads=2)
    cache = args.root / 'corpus/embedding-cache'
    cache.mkdir(parents=True, exist_ok=True)
    vectors = [None] * len(chunks)
    pending = []
    for i, c in enumerate(chunks):
        key = digest(MODEL + '\n' + c['title'] + '\n' + c['text'])
        path = cache / (key + '.npy')
        if path.exists():
            vectors[i] = np.load(path, allow_pickle=False)
        else:
            pending.append((i, path, c['title'] + '\n' + c['text']))
    for start in range(0, len(pending), 64):
        batch = pending[start:start + 64]
        for (i, path, _), vector in zip(batch, model.embed([x[2] for x in batch], batch_size=32), strict=True):
            v = np.asarray(vector, dtype=np.float32)
            if v.shape != (DIMENSION,) or not np.isfinite(v).all():
                raise ValueError('Invalid embedding')
            temp = path.with_suffix('.tmp')
            with temp.open('wb') as f:
                np.save(f, v, allow_pickle=False)
            os.replace(temp, path)
            vectors[i] = v
        print(canonical({'embedded': min(start + 64, len(pending)), 'newTotal': len(pending)}), flush=True)
    matrix = np.asarray(vectors, dtype=np.float32)
    if matrix.shape != (len(chunks), DIMENSION) or not np.isfinite(matrix).all():
        raise ValueError('Embedding matrix mismatch')
    sql(args.container, '''CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS official_chunks (
       corpus_version text NOT NULL, chunk_id text NOT NULL, source_version text NOT NULL,
       embedding vector(384) NOT NULL, PRIMARY KEY(corpus_version, chunk_id));''')
    existing = int(sql(args.container, 'SELECT count(*) FROM official_chunks WHERE corpus_version=' +
                       literal(manifest['corpusVersion']) + ';').splitlines()[-1])
    if existing not in (0, len(chunks)):
        raise RuntimeError('Partial existing index; refuse to silently replace it')
    if existing == 0:
        buffer = io.StringIO()
        # COPY's terminator and data must use the same newline convention.
        writer = csv.writer(buffer, lineterminator='\n')
        for c, v in zip(chunks, matrix, strict=True):
            writer.writerow([manifest['corpusVersion'], c['chunkId'], c['sourceVersion'], vector_text(v)])
        sql(args.container, 'BEGIN; COPY official_chunks(corpus_version,chunk_id,source_version,embedding) '
                            'FROM STDIN WITH (FORMAT csv);\n' + buffer.getvalue() + '\\.\nCOMMIT;')
    np.save(args.root / 'corpus/vectors.npy', matrix, allow_pickle=False)
    save(args.root / 'corpus/index.json', {'corpusVersion': manifest['corpusVersion'], 'model': MODEL,
          'dimension': DIMENSION, 'chunkCount': len(chunks), 'engine': 'pgvector_exact_cosine',
          'container': args.container, 'vectorsSha256': digest((args.root / 'corpus/vectors.npy').read_bytes())})
    print(canonical({'indexed': len(chunks), 'corpusVersion': manifest['corpusVersion']}))


def retrieve(root: Path, query: str, model_cache: Path, container: str, strategy='rrf') -> dict:
    from fastembed import TextEmbedding
    from dc_evals.retrieval import BM25, tokenize, rrf
    if not query.strip() or len(query) > 800:
        raise ValueError('A bounded learning-goal query is required')
    manifest, chunks = verified_corpus(root)
    index = load(root / 'corpus/index.json')
    if index['corpusVersion'] != manifest['corpusVersion'] or index['model'] != MODEL:
        raise ValueError('Stale index')
    ids = {i: c['chunkId'] for i, c in enumerate(chunks)}
    by_id = {c['chunkId']: c for c in chunks}
    bm = BM25([c['title'] + '\n' + c['text'] for c in chunks]).scores(tokenize(query))
    bm_scores = {ids[i]: score for i, score in bm.items()}
    model = TextEmbedding(model_name=MODEL, cache_dir=str(model_cache), threads=2)
    vector = next(iter(model.embed([QUERY_PREFIX + query])))
    rows = sql(container, 'SELECT chunk_id,1-(embedding <=> ' + literal(vector_text(vector)) + '::vector) '
               'FROM official_chunks WHERE corpus_version=' + literal(manifest['corpusVersion']) +
               ' ORDER BY embedding <=> ' + literal(vector_text(vector)) + '::vector,chunk_id LIMIT 40;')
    vector_scores = {r.split('|')[0]: float(r.split('|')[1]) for r in rows.splitlines() if '|' in r}
    if not vector_scores:
        raise ValueError('Missing PostgreSQL corpus collection')
    bm_scores = dict(sorted(bm_scores.items(), key=lambda x: (-x[1], x[0]))[:40])
    scores = {'bm25': bm_scores, 'vector': vector_scores,
              'rrf': rrf([bm_scores, vector_scores])}[strategy]
    ranked = sorted(scores, key=lambda k: (-scores[k], k))[:20]
    selected, chars = [], 0
    for cid in ranked:
        c = by_id[cid]
        if chars + len(c['text']) > 12000:
            continue
        selected.append(c)
        chars += len(c['text'])
        if len(selected) == 8:
            break
    packet = {'corpusVersion': manifest['corpusVersion'], 'query': query, 'strategy': strategy,
              'retrievalConfigVersion': 1, 'candidateRanks': [{'chunkId': cid, 'rank': n + 1,
              'score': scores[cid]} for n, cid in enumerate(ranked)], 'evidence': selected,
              'status': 'retrieved_not_semantically_validated'}
    packet['evidenceHash'] = digest(canonical(packet))
    return packet


def search(args) -> None:
    packet = retrieve(args.root, args.query, args.model_cache, args.container, args.strategy)
    if args.output:
        save(args.output, packet)
        print(canonical({'output': str(args.output), 'evidenceHash': packet['evidenceHash']}))
    else:
        print(json.dumps(packet, ensure_ascii=False))


def private_coverage(args) -> None:
    """Raw text stays in the explicitly private directory; model-visible output is IDs/counts only."""
    from pypdf import PdfReader
    pdf = args.pdf.resolve(strict=True)
    private_root = args.private_root.resolve()
    if private_root == REPO or REPO in private_root.parents:
        raise ValueError('Private material must remain outside the repository')
    private_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(private_root, 0o700)
    taxonomy = load(args.taxonomy)
    for concept in taxonomy['concepts']:
        if not re.fullmatch(r'[a-z0-9-]+', concept['conceptId']):
            raise ValueError('Invalid concept ID')
        if not concept.get('terms') or any(len(t) < 2 or len(t) > 80 for t in concept['terms']):
            raise ValueError('Bounded, public-taxonomy terms required')
    private_pages = private_root / 'pages'
    private_pages.mkdir(exist_ok=True, mode=0o700)
    counts = {c['conceptId']: 0 for c in taxonomy['concepts']}
    page_ledger = []
    reader = PdfReader(pdf)
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ''
        raw_path = private_pages / f'{number:04d}.txt'
        fd = os.open(raw_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(text)
        hits = []
        for c in taxonomy['concepts']:
            if any(re.search(r'(?<![A-Za-z0-9])' + re.escape(t) + r'(?![A-Za-z0-9])', text, re.I)
                   for t in c['terms']):
                counts[c['conceptId']] += 1
                hits.append(c['conceptId'])
        page_ledger.append({'page': number, 'textHash': digest(text), 'textChars': len(text), 'conceptIds': hits})
    save(private_root / 'ledger.json', {'pdfSha256': digest(pdf.read_bytes()), 'pages': page_ledger,
          'mode': 'local_taxonomy_only', 'unit': 'page term hits, not semantic question classification'})
    os.chmod(private_root / 'ledger.json', 0o600)
    save(args.root / 'curriculum/pdf-coverage.json', {'mode': 'local_taxonomy_only', 'pageCount': len(reader.pages),
          'conceptPageHits': counts, 'unmappedPages': sum(not p['conceptIds'] for p in page_ledger),
          'emptyTextPages': sum(not p['textChars'] for p in page_ledger),
          'limitations': 'Public taxonomy term hits are coverage clues; not question counts, topic importance or complete semantic analysis.'})
    print(canonical({'pages': len(reader.pages), 'matchedConcepts': sum(v > 0 for v in counts.values()),
                     'mode': 'local_taxonomy_only', 'rawTextSentToModel': False}))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, required=True, help='Task control directory outside the checkout')
    commands = p.add_subparsers(dest='command', required=True)
    q = commands.add_parser('inventory')
    q.add_argument('--deck', type=Path, default=REPO / 'content/decks/aws-saa-fundamentals.md')
    q.set_defaults(func=inventory)
    q = commands.add_parser('fetch')
    q.add_argument('--seeds', type=Path, required=True)
    q.set_defaults(func=fetch)
    for command, function in [('embed', embed), ('search', search)]:
        q = commands.add_parser(command)
        q.add_argument('--model-cache', type=Path, required=True)
        q.add_argument('--container', required=True)
        if command == 'search':
            q.add_argument('--query', required=True)
            q.add_argument('--strategy', choices=['bm25', 'vector', 'rrf'], default='rrf')
            q.add_argument('--output', type=Path)
        q.set_defaults(func=function)
    q = commands.add_parser('private-coverage')
    q.add_argument('--pdf', type=Path, required=True)
    q.add_argument('--private-root', type=Path, required=True)
    q.add_argument('--taxonomy', type=Path, required=True)
    q.set_defaults(func=private_coverage)
    args = p.parse_args()
    args.root = args.root.resolve()
    if args.root == REPO or REPO in args.root.parents:
        p.error('Control/evidence data must remain outside the checkout')
    args.root.mkdir(parents=True, exist_ok=True)
    args.func(args)


if __name__ == '__main__':
    main()
