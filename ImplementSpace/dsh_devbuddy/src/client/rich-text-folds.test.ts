/**
 * Headless (jsdom) reproduction/regression test for the rich-text section
 * folding extension. Run with:  node --test src/client/rich-text-folds.test.ts
 *
 * It mounts a real Tiptap editor, then verifies:
 *   - a chevron widget is rendered for every heading,
 *   - clicking the chevron toggles the section (the callback fires),
 *   - a folded section's blocks receive the hidden-body class,
 *   - auto-unfold resolves the section containing a caret position.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
// Type-only (erased at run time) so the module itself is loaded AFTER the
// jsdom globals below are installed.
import type { FoldApi } from './rich-text-folds.ts'

const require = createRequire(import.meta.url)
// jsdom is not a dependency of this package; borrow the copy that ships with
// the local agent runtime (any Node >= 20 compatible jsdom works).
const { JSDOM } = require('/home/l-xiezhenxun/.hermes/hermes-agent/node_modules/jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>')

const g = globalThis as unknown as Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true })
for (const key of [
  'HTMLElement', 'HTMLDivElement', 'HTMLSpanElement', 'Element', 'Node', 'NodeList',
  'MouseEvent', 'KeyboardEvent', 'Event', 'CustomEvent', 'DOMParser', 'XMLSerializer',
  'Range', 'Text', 'DocumentFragment', 'MutationObserver', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'DOMRect', 'Selection',
]) {
  if (dom.window[key] !== undefined) g[key] = dom.window[key]
}
if (g.requestAnimationFrame === undefined) {
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0)
  g.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const folds = await import('./rich-text-folds.ts')

const HTML = '<h1>One</h1><p>a</p><p>b</p><h2>Nested</h2><p>c</p><h1>Two</h1><p>d</p>'

interface Harness {
  editor: InstanceType<typeof Editor>
  element: HTMLElement
  toggled: string[]
}

function mount(): Harness {
  const element = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(element)
  const toggled: string[] = []
  const api: { current: FoldApi } = {
    current: {
      folds: new Set<string>(),
      toggle: (key: string) => {
        toggled.push(key)
        const next = new Set(api.current.folds)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        api.current = { ...api.current, folds: next }
        editor.view.dispatch(editor.state.tr.setMeta(folds.SECTION_FOLD_META, true))
      },
      foldTitle: 'Fold',
      unfoldTitle: 'Unfold',
    },
  }
  const editor = new Editor({
    element,
    extensions: [StarterKit, folds.makeSectionFolding(api)],
    content: HTML,
  })
  return { editor, element, toggled }
}

/**
 * Mount the way the React component does: the extension is created with a
 * placeholder API (the `useRef` initial value), the editor is built, and only
 * THEN does an effect swap in the live API and ask for a rebuild. The widget
 * must still toggle — a stale closure here is the "click does nothing" bug.
 */
function mountLikeReact(): Harness {
  const element = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(element)
  const toggled: string[] = []
  const api: { current: FoldApi } = {
    current: { folds: new Set(), toggle: () => {}, foldTitle: '', unfoldTitle: '' },
  }
  const editor = new Editor({
    element,
    extensions: [StarterKit, folds.makeSectionFolding(api)],
    content: HTML,
  })
  // The "effect" that follows editor creation.
  api.current = {
    folds: new Set<string>(),
    toggle: (key: string) => {
      toggled.push(key)
      const next = new Set(api.current.folds)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      api.current = { ...api.current, folds: next }
      editor.view.dispatch(editor.state.tr.setMeta(folds.SECTION_FOLD_META, true))
    },
    foldTitle: 'Fold',
    unfoldTitle: 'Unfold',
  }
  editor.view.dispatch(editor.state.tr.setMeta(folds.SECTION_FOLD_META, true))
  return { editor, element, toggled }
}

test('a chevron widget is rendered for every heading', () => {
  const h = mount()
  try {
    const chevrons = h.element.querySelectorAll(`.${folds.FOLD_CHEVRON_CLASS}`)
    assert.equal(chevrons.length, 3, 'one chevron per heading')
    assert.equal(chevrons[0].textContent, '▾')
  } finally {
    h.editor.destroy()
  }
})

test('clicking the chevron toggles that section', () => {
  const h = mount()
  try {
    const chevron = h.element.querySelectorAll(`.${folds.FOLD_CHEVRON_CLASS}`)[0] as HTMLElement
    chevron.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    assert.deepEqual(h.toggled, ['1:one'], 'the click must reach the toggle callback')
  } finally {
    h.editor.destroy()
  }
})

test('a folded section hides its body blocks (and stops at the next same-level heading)', () => {
  const h = mount()
  try {
    const chevron = h.element.querySelectorAll(`.${folds.FOLD_CHEVRON_CLASS}`)[0] as HTMLElement
    chevron.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    const hidden = h.element.querySelectorAll(`.${folds.FOLDED_BODY_CLASS}`)
    // Section "One" spans p(a), h2(Nested), p(c) — but not h1(Two)/p(d).
    const hiddenText = Array.from(hidden).map(n => n.textContent)
    assert.ok(hiddenText.includes('a'), `expected p(a) hidden, got ${JSON.stringify(hiddenText)}`)
    assert.ok(hiddenText.includes('c'), 'nested content stays inside the folded section')
    assert.ok(!hiddenText.includes('d'), 'the next h1 section must stay visible')
  } finally {
    h.editor.destroy()
  }
})

test('auto-unfold resolves the folded section containing a caret position', () => {
  const h = mount()
  try {
    const foldsSet = new Set(['1:one'])
    // Position inside the first paragraph (after the h1).
    const pos = 1 + h.editor.state.doc.firstChild!.nodeSize + 1
    assert.equal(folds.foldedKeyAtPos(h.editor.state.doc, pos, foldsSet), '1:one')
    // A position in the second section must not match.
    const twoPos = h.editor.state.doc.content.size - 2
    assert.equal(folds.foldedKeyAtPos(h.editor.state.doc, twoPos, foldsSet), null)
  } finally {
    h.editor.destroy()
  }
})

test('a widget built before the live API was injected still toggles (DOM-reuse regression)', () => {
  const h = mountLikeReact()
  try {
    const chevron = h.element.querySelectorAll(`.${folds.FOLD_CHEVRON_CLASS}`)[0] as HTMLElement
    assert.equal(chevron.title, 'Fold', 'the rebuilt widget must carry the live titles')
    chevron.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    assert.deepEqual(h.toggled, ['1:one'], 'the rebuilt widget must carry the live toggle')
  } finally {
    h.editor.destroy()
  }
})

test('a fold survives a document edit (apply rebuild path)', () => {
  const h = mount()
  try {
    const chevron = h.element.querySelectorAll(`.${folds.FOLD_CHEVRON_CLASS}`)[0] as HTMLElement
    chevron.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    assert.ok(h.element.querySelectorAll(`.${folds.FOLDED_BODY_CLASS}`).length > 0)
    // Type into the last paragraph: the fold must be re-applied to the new doc.
    const end = h.editor.state.doc.content.size - 1
    h.editor.view.dispatch(h.editor.state.tr.insertText('!', end))
    const hidden = h.element.querySelectorAll(`.${folds.FOLDED_BODY_CLASS}`)
    const hiddenText = Array.from(hidden).map(n => n.textContent)
    assert.ok(hiddenText.includes('a'), 'the fold must persist across edits')
    assert.ok(!hiddenText.includes('d!'), 'the edited section stays visible')
  } finally {
    h.editor.destroy()
  }
})

test('the chevron renders inline at the start of its heading', () => {
  const h = mount()
  try {
    const chevron = h.element.querySelectorAll(`.${folds.FOLD_CHEVRON_CLASS}`)[0] as HTMLElement
    const heading = h.element.querySelector('h1')
    assert.ok(heading !== null)
    assert.ok(heading.contains(chevron), 'the chevron must live inside the heading, not above it')
  } finally {
    h.editor.destroy()
  }
})
