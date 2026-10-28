import hashlib
import unittest

from retrieval_v4 import StructuralIndex, pack, parse_blocks, plan_query


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def fixture(text, spans=None):
    source = {'sourceId': digest('synthetic-source'), 'text': text, 'sourceVersion': digest(text)}
    spans = spans if spans is not None else [(0, len(text))]
    chunks = [{'chunkId': f'{i:032x}', 'evidenceId': f'ev-{i:032x}', 'sourceId': source['sourceId'],
               'sourceVersion': source['sourceVersion'], 'charStart': a, 'charEnd': b,
               'text': text[a:b], 'textSha256': digest(text[a:b])} for i, (a, b) in enumerate(spans)]
    return StructuralIndex([source], chunks), chunks


def queue(*chunks):
    return [{'chunkId': c['chunkId'], 'score': float(len(chunks) - i)} for i, c in enumerate(chunks)]


class QueryTests(unittest.TestCase):
    def test_cap_and_literal_spans(self):
        raw = 'For Z, what A; how B; why C; where D; which E'
        plan = plan_query(raw)
        self.assertEqual([f['text'] for f in plan['forms']], [raw, 'For Z, what A', 'For Z, how B', 'For Z, why C', 'For Z, where D'])
        self.assertEqual(plan['droppedFacetCount'], 1)
        facet = plan['forms'][1]
        self.assertEqual(facet['rawSpans'], [[0, 6], [7, 13]])
        self.assertIsNone(facet['origin'][6])

    def test_finite_grammar(self):
        cases = [('what A and how B', ['what A', 'how B']), ('what A and B', []),
                 ('what A; how B in Z', []), ('what "A;B"; how C', ['what "A;B"', 'how C']),
                 ('what (A; how B', []), ('what A;;how B', []), ('what A;what A', ['what A']),
                 ('what A]; how B', []), ('what \\"A; how B', []),
                 ('what [A;B]; how C', ['what [A;B]', 'how C']),
                 ('what A or how B', []), ('what A; how B without C', [])]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual([f['text'] for f in plan_query(raw)['forms'][1:]], expected)

    def test_scalar_origins_and_ascii_whitespace(self):
        raw = ' \twhat 😀A;\r\n how B\u00a0C '
        plan = plan_query(raw)
        self.assertEqual(plan['queryHash'], digest(raw))
        self.assertEqual(plan['forms'][2]['text'], 'how B\u00a0C')
        for form in plan['forms']:
            self.assertEqual(len(form['text']), len(form['origin']))
            for char, origin in zip(form['text'], form['origin']):
                if char not in ' \t\r\n\v\f':
                    self.assertEqual(raw[slice(*origin)], char)
                    self.assertTrue(any(a <= origin[0] < origin[1] <= b for a, b in form['rawSpans']))
        self.assertEqual(plan['forms'][1]['rawSpans'], [[2, 9]])

    def test_reject_invalid_text(self):
        for raw in ['what\0 A', 'what \ud800', '', '123', 'a' * 801]:
            with self.subTest(raw=repr(raw)), self.assertRaises((ValueError, UnicodeError)):
                plan_query(raw)
        with self.assertRaises(ValueError):
            plan_query(b'\xff')


class StructureTests(unittest.TestCase):
    def test_r3_radius_and_no_neighbor_fill(self):
        text = '# H\n\nA.\n\nNote:\nB.\n\n- C\n- D\n\n```\nx=1\n```\n'
        blocks = parse_blocks('s', text)
        index, chunks = fixture(text, [(b['start'], b['end']) for b in blocks])
        h, a, n, l, f = chunks
        self.assertEqual(index.closure(a['chunkId'], 1), [h, a, n])
        self.assertIsNone(index.closure(n['chunkId'], 1))
        self.assertEqual(index.closure(n['chunkId'], 2), [h, a, n])
        self.assertIsNone(index.closure(l['chunkId'], 1))
        self.assertIsNone(index.closure(l['chunkId'], 2))
        self.assertTrue(all(index.eligible(c['chunkId']) for c in chunks))

    def test_table_is_one_block_and_all_rows_required(self):
        text = '|A|B|\n|---|---|\n|1|2|\n'
        spans, start = [], 0
        for line in text.splitlines(keepends=True):
            spans.append((start, start + len(line)))
            start += len(line)
        index, chunks = fixture(text, spans)
        self.assertEqual(len(index.blocks[chunks[0]['sourceId']]), 1)
        self.assertEqual(index.closure(chunks[1]['chunkId'], 1), chunks)
        self.assertIsNone(index.closure(chunks[0]['chunkId'], 1))

    def test_malformed_structures_unknown(self):
        for text in ['```\nx=1\n', '|---|---|\n', 'A\n|---|---|\n', '|A|B|\n|---|---|\n|1|2|3|\n', 'Note:\n\n\nOther\n']:
            index, chunks = fixture(text)
            self.assertIsNone(index.closure(chunks[0]['chunkId'], 2), text)
        blocks = parse_blocks('s', '|A\\|B|C|\n|---|---|\n|x|y|\n')
        self.assertEqual([b['kind'] for b in blocks], ['table'])

    def test_offsets_priority_and_boundaries(self):
        text = '# 😀\r\n\r\n- x\r\n    y\r\n\r\nNote\r\n\r\nbody\r\n\r\n~~~\r\n# not heading\r\n~~~\r\n'
        blocks = parse_blocks('s', text)
        self.assertEqual([b['kind'] for b in blocks], ['heading', 'list', 'note', 'fence'])
        self.assertEqual(text[blocks[2]['start']:blocks[2]['end']], 'Note\r\n\r\nbody\r\n')
        self.assertFalse(any(b['ambiguous'] for b in blocks))
        self.assertEqual(len(parse_blocks('s', 'A\u2028B\n')), 1)

    def test_direct_relations_do_not_expand_related_roots(self):
        text = 'A\n\nNote:\nx\n\nB\n'
        # Related overlap touches B, but B must never become another root.
        spans = [(0, 2), (3, 11), (9, len(text)), (12, len(text))]
        index, chunks = fixture(text, spans)
        self.assertEqual(index.closure(chunks[0]['chunkId'], 2), chunks[:3])
        self.assertIs(index.closure(chunks[0]['chunkId'], 2)[2], chunks[2])

    def test_original_validation(self):
        index, chunks = fixture('A.\n')
        source = next(iter(index.sources.values()))
        for change in [{'text': 'other'}, {'sourceId': 'unknown'}, {'sourceVersion': 'bad'}, {'charEnd': 99}]:
            with self.assertRaises(ValueError):
                StructuralIndex([source], [{**chunks[0], **change}])
        with self.assertRaises(ValueError):
            StructuralIndex([source], [chunks[0], chunks[0]])

    def test_code_exemption_and_exact_chrome_r3_regressions(self):
        text = '```\nFeedback\nDocumentation = {"limit": 3}\nYes\n```\n'
        starts = [0]
        for line in text.splitlines(keepends=True):
            starts.append(starts[-1] + len(line))
        index, chunks = fixture(text, list(zip(starts, starts[1:])))
        self.assertTrue(all(index.eligible(c['chunkId']) for c in chunks))
        empty_index, empty_chunks = fixture(text, [(4, 4)])
        self.assertTrue(empty_index.eligible(empty_chunks[0]['chunkId']))
        for text, eligible in [('Feedback\nYes\n', False), ('Feedback\nx=1\n', True),
                               ('Documentation = {"limit": 3}', True), ('DocumentationSavings PlansUser Guide', False),
                               ('Documentation is available', True), ('Documentation Article', True),
                               ('DocumentationArticle', False), ('documentation', False),
                               ('Documentation X`y`', True), ('Documentation X{y}', True),
                               ('Documentation X=y', True), ('- Privacy', False), ('', False)]:
            index, chunks = fixture(text)
            self.assertEqual(index.eligible(chunks[0]['chunkId']), eligible, text)


class PackingTests(unittest.TestCase):
    def test_round_robin_duplicates_and_immutable_objects(self):
        index, chunks = fixture('A\n\nB\n\nC\n', [(0, 2), (3, 5), (6, 8)])
        selected, trace = pack([queue(chunks[0], chunks[1]), queue(chunks[2], chunks[0])], index, 1)
        self.assertEqual(selected, [chunks[0], chunks[2], chunks[1]])
        self.assertEqual([v['seed'] for v in trace], [c['chunkId'] for c in [chunks[0], chunks[2], chunks[1], chunks[0]]])
        self.assertEqual(trace[-1]['outcome'], 'duplicate')
        self.assertIs(selected[0], chunks[0])

    def test_full_scalar_budget_exhausts_queues(self):
        text = '😀' * 11999 + '\n\n' + 'B\n\nC\n'
        index, chunks = fixture(text, [(0, 12000), (12001, 12003), (12004, 12006)])
        selected, trace = pack([queue(*chunks)], index, 1)
        self.assertEqual(selected, [chunks[0]])
        self.assertEqual([t['outcome'] for t in trace], ['added', 'budget', 'budget'])

    def test_atomic_missing_remainder_and_continue(self):
        class Abstract:
            chunks = {str(i): {'chunkId': str(i), 'text': 'x' * 100} for i in range(12)}
            def closure(self, seed, radius):
                ids = {'0': list(range(7)), '7': [6, 7, 8], '9': [6, 9]}[seed]
                return [self.chunks[str(i)] for i in ids]
            def eligible(self, cid):
                return True
        structural = Abstract()
        selected, trace = pack([[{'chunkId': cid, 'score': score} for cid, score in [('0', 3), ('7', 2), ('9', 1)]]], structural, 1)
        self.assertEqual([c['chunkId'] for c in selected], ['0', '1', '2', '3', '4', '5', '6', '9'])
        self.assertEqual(trace[1]['outcome'], 'budget')
        self.assertEqual(trace[1]['addedIds'], [])

    def test_already_selected_seed_can_add_missing_closure(self):
        class Abstract:
            chunks = {cid: {'chunkId': cid, 'text': cid} for cid in 'abc'}
            def closure(self, seed, radius):
                return [self.chunks[cid] for cid in {'a': 'ab', 'b': 'bc'}[seed]]
            def eligible(self, cid):
                return True
        selected, trace = pack([[{'chunkId': 'a', 'score': 2}, {'chunkId': 'b', 'score': 1}]], Abstract(), 1)
        self.assertEqual([c['chunkId'] for c in selected], list('abc'))
        self.assertEqual(trace[1]['addedIds'], ['c'])

    def test_overlapping_originals_count_twice(self):
        text = 'x' * 7000
        index, chunks = fixture(text, [(0, 6500), (500, 7000)])
        self.assertEqual(index.closure(chunks[0]['chunkId'], 1), chunks)
        selected, trace = pack([queue(chunks[0])], index, 1)
        self.assertEqual(selected, [])
        self.assertEqual(trace[0]['outcome'], 'budget')
        # Actual content fits 7000 scalars; both original objects total 13000.
        self.assertEqual(sum(len(c['text']) for c in chunks), 13000)

    def test_attachment_ineligibility_rejects_whole_closure(self):
        text = '# H\n\nPrivacy\n'
        index, chunks = fixture(text, [(0, 4), (5, len(text))])
        selected, trace = pack([queue(chunks[1])], index, 1)
        self.assertEqual(selected, [])
        self.assertEqual(trace[0]['outcome'], 'ineligible')

    def test_nonfinite_membership_limits_and_ties(self):
        index, chunks = fixture('A\n\nB\n', [(0, 2), (3, 5)])
        for score in [float('nan'), float('inf'), -float('inf'), True]:
            with self.assertRaises(ValueError):
                pack([[{'chunkId': chunks[0]['chunkId'], 'score': score}]], index, 1)
        for queues in [[queue(chunks[0], chunks[0])], [[{'chunkId': 'missing', 'score': 1}]], [[]] * 6, [queue(*([chunks[0]] * 41))]]:
            with self.assertRaises(ValueError):
                pack(queues, index, 1)
        selected, _ = pack([[{'chunkId': c['chunkId'], 'score': 1} for c in reversed(chunks)]], index, 1)
        self.assertEqual(selected, chunks)


if __name__ == '__main__':
    unittest.main()
