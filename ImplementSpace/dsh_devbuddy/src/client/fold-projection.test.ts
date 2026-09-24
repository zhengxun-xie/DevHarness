/**
 * Unit tests for the source-surface fold projection (pure functions, no DOM).
 * Run with:  node --test src/client/fold-projection.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProjection, lfOffsetOf, mapDisplayEdit, rawOffsetOf } from './fold-projection.ts'

const DRAFT = [
  '# One',
  'alpha',
  'beta',
  '## Nested',
  'gamma',
  '# Two',
  'delta',
].join('\n')

test('no folds: the projection is the draft and offsets are identity', () => {
  const p = buildProjection(DRAFT, new Set())
  assert.equal(p.text, DRAFT)
  assert.equal(p.folded, false)
  assert.equal(p.toDraft(5), 5)
  assert.equal(p.toDisplay(5), 5)
  assert.equal(p.lineToDisplay(3), 3)
})

test('folding a section removes its body lines so later lines move up', () => {
  const p = buildProjection(DRAFT, new Set(['1:one']))
  assert.equal(p.folded, true)
  // h1 "One" hides alpha/beta/## Nested/gamma, stops at h1 "Two".
  assert.equal(p.text, ['# One', '# Two', 'delta'].join('\n'))
  assert.equal(p.spans.length, 1)
  assert.deepEqual([p.spans[0].startLine, p.spans[0].endLine], [1, 4])
})

test('a nested fold inside a folded parent is not double-counted', () => {
  const p = buildProjection(DRAFT, new Set(['1:one', '2:nested']))
  assert.equal(p.spans.length, 1, 'the outer span already hides the nested one')
  assert.equal(p.text, ['# One', '# Two', 'delta'].join('\n'))
})

test('folding a nested section keeps the outer body visible', () => {
  const p = buildProjection(DRAFT, new Set(['2:nested']))
  assert.equal(p.text, ['# One', 'alpha', 'beta', '## Nested', '# Two', 'delta'].join('\n'))
})

test('folding the last section hides everything to the end of the document', () => {
  const p = buildProjection(DRAFT, new Set(['1:two']))
  assert.equal(p.text, ['# One', 'alpha', 'beta', '## Nested', 'gamma', '# Two'].join('\n'))
})

test('offsets on kept lines round-trip; hidden offsets clamp to the fold point', () => {
  const p = buildProjection(DRAFT, new Set(['1:one']))
  // "# One\n" is 6 chars; the draft offset of "# Two" is 6 + len("alpha\nbeta\n## Nested\ngamma\n") = 34.
  const twoInDraft = DRAFT.indexOf('# Two')
  assert.equal(p.toDisplay(twoInDraft), '# One\n'.length, 'the h1 Two line follows the heading directly')
  assert.equal(p.toDraft(p.toDisplay(twoInDraft)), twoInDraft)
  // An offset inside the hidden body clamps to the end of the folded heading line.
  const insideHidden = DRAFT.indexOf('beta')
  assert.equal(p.toDisplay(insideHidden), '# One'.length)
  // Line mapping reports hidden lines as null.
  assert.equal(p.lineToDisplay(1), null)
  assert.equal(p.lineToDisplay(5), 1)
  assert.equal(p.displayLineToDraft(1), 5)
})

test('typing inside a kept line lands at the right draft offset', () => {
  const p = buildProjection(DRAFT, new Set(['1:one']))
  // Type "!" after "# Two" in the display: display offset = len("# One\n# Two") = 11.
  const at = '# One\n# Two'.length
  const next = `${p.text.slice(0, at)}!${p.text.slice(at)}`
  const mapped = mapDisplayEdit(DRAFT, p, next)
  assert.ok(mapped !== null)
  assert.equal(mapped.draft, DRAFT.replace('# Two', '# Two!'))
  assert.equal(mapped.draft.length, DRAFT.length + 1)
})

test('deleting a character in a kept line maps back to the draft', () => {
  const p = buildProjection(DRAFT, new Set(['1:one']))
  const at = p.text.indexOf('delta')
  const next = p.text.slice(0, at) + p.text.slice(at + 1)
  const mapped = mapDisplayEdit(DRAFT, p, next)
  assert.ok(mapped !== null)
  assert.equal(mapped.draft, DRAFT.replace('delta', 'elta'))
})

test('editing the heading text of a folded section maps correctly', () => {
  const p = buildProjection(DRAFT, new Set(['1:one']))
  const next = p.text.replace('# One', '# Uno')
  const mapped = mapDisplayEdit(DRAFT, p, next)
  assert.ok(mapped !== null)
  assert.equal(mapped.draft.split('\n')[0], '# Uno')
  assert.ok(mapped.draft.includes('beta'), 'the hidden body must survive a heading edit')
})

test('an edit that would consume a hidden section is refused', () => {
  const p = buildProjection(DRAFT, new Set(['1:one']))
  // Select from "# One" through "# Two" in the display and delete it.
  const next = 'delta'
  const mapped = mapDisplayEdit(DRAFT, p, next)
  assert.equal(mapped, null, 'the caller must unfold instead of deleting folded content')
})

test('editing while nothing is folded is an ordinary edit', () => {
  const p = buildProjection(DRAFT, new Set())
  const mapped = mapDisplayEdit(DRAFT, p, `${DRAFT}x`)
  assert.ok(mapped !== null)
  assert.equal(mapped.draft, `${DRAFT}x`)
})

test('CRLF offsets convert between the raw and LF models', () => {
  const raw = 'ab\r\ncd\r\nef'
  assert.equal(lfOffsetOf(raw, 4), 3)
  assert.equal(rawOffsetOf(raw, 3), 4)
  assert.equal(rawOffsetOf(raw, 5), 6)
  assert.equal(rawOffsetOf(raw, 6), 8)
})
