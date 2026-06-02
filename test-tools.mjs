/**
 * Unit tests for the getframe conversion core (convert.mjs).
 * Network-free — uses convertSource() on inline compiled-Framer fixtures.
 * Run with: node test-tools.mjs
 */

import { convertSource, __test__ } from './convert.mjs'

const { classifyImportSource, resolveBundleSymbol, esmShPackage, findReExportTarget, extractComponentName } = __test__

// ── tiny test harness ─────────────────────────────────────────────────────────
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); passed++ }
  catch (err) { console.log(`  ❌  ${name}\n      ${err.message}`); failed++ }
}
function eq(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
function contains(s, sub) { if (!s.includes(sub)) throw new Error(`Expected to contain ${JSON.stringify(sub)}\nGot: ${s.slice(0, 300)}`) }
function notContains(s, sub) { if (s.includes(sub)) throw new Error(`Expected NOT to contain ${JSON.stringify(sub)}`) }

// ── classifyImportSource ────────────────────────────────────────────────────--
console.log('\nclassifyImportSource:')
test('bare package kept', () => eq(classifyImportSource('react'), { kind: 'bare', pkg: 'react' }))
test('"framer" dropped', () => eq(classifyImportSource('framer'), { kind: 'drop' }))
test('framer motion CDN → framer-motion', () => eq(classifyImportSource('https://framer.com/m/framer/motion-a.js@h'), { kind: 'pkg', pkg: 'framer-motion' }))
test('framer react CDN → react', () => eq(classifyImportSource('https://framer.com/m/framer/react-x.js'), { kind: 'pkg', pkg: 'react' }))
test('esm.sh → pkg', () => eq(classifyImportSource('https://esm.sh/three@0.160.0'), { kind: 'pkg', pkg: 'three' }))
test('framerusercontent submodule → unresolved', () => eq(classifyImportSource('https://framerusercontent.com/modules/a/b/c.js').kind, 'unresolved'))
test('jsdelivr bundle → split', () => eq(classifyImportSource('https://cdn.jsdelivr.net/gh/x/bundle.js').kind, 'split'))

// ── resolveBundleSymbol (priority) ────────────────────────────────────────────
console.log('\nresolveBundleSymbol:')
test('Canvas → fiber', () => eq(resolveBundleSymbol('Canvas'), '@react-three/fiber'))
test('OrbitControls → drei (wins over stdlib)', () => eq(resolveBundleSymbol('OrbitControls'), '@react-three/drei'))
test('UnrealBloomPass → three-stdlib', () => eq(resolveBundleSymbol('UnrealBloomPass'), 'three-stdlib'))
test('Color (unknown) → three default', () => eq(resolveBundleSymbol('Color'), 'three'))

// ── esmShPackage ──────────────────────────────────────────────────────────────
console.log('\nesmShPackage:')
test('three with version', () => eq(esmShPackage('https://esm.sh/three@0.160.0'), 'three'))
test('react jsx-runtime subpath', () => eq(esmShPackage('https://esm.sh/react@18/jsx-runtime'), 'react/jsx-runtime'))
test('scoped package', () => eq(esmShPackage('https://esm.sh/@react-three/fiber@8.0.0'), '@react-three/fiber'))

// ── findReExportTarget (stub following) ───────────────────────────────────────
console.log('\nfindReExportTarget:')
test('export * stub returns target', () => eq(
  findReExportTarget('export * from "https://framerusercontent.com/modules/a/b/C.js"\nexport { default } from "https://framerusercontent.com/modules/a/b/C.js"'),
  'https://framerusercontent.com/modules/a/b/C.js'))
test('real source (has code) returns null', () => eq(
  findReExportTarget('import x from "react"\nexport default function C(){return null}'), null))

// ── extractComponentName ──────────────────────────────────────────────────────
console.log('\nextractComponentName:')
test('prod url', () => eq(extractComponentName('https://framer.com/m/DepthGlobe-prod-5cOY4e.js'), 'DepthGlobe'))
test('hashed url', () => eq(extractComponentName('https://framer.com/m/ShaderButton-Xyz789.js@def'), 'ShaderButton'))

// ── full pipeline on an inline compiled-Framer fixture ────────────────────────
console.log('\nconvertSource (end-to-end, offline):')

const FIXTURE = [
  'import{jsx as _jsx}from"react/jsx-runtime";',
  'import{useState}from"https://esm.sh/react@18";',
  'import{addPropertyControls,ControlType,RenderTarget}from"framer";',
  'import{Canvas,useFrame}from"https://cdn.jsdelivr.net/gh/x/bundle.js";',
  'import{Color,Vector3}from"https://cdn.jsdelivr.net/gh/x/bundle.js";',
  'import{OrbitControls}from"https://cdn.jsdelivr.net/gh/x/bundle.js";',
  'import{EffectComposer}from"https://cdn.jsdelivr.net/gh/x/bundle.js";',
  'export default function Widget({label="hi",count,mode,style}){const onCanvas=RenderTarget.current()===RenderTarget.canvas;return _jsx("div",{children:label});}',
  'addPropertyControls(Widget,{label:{type:ControlType.String,defaultValue:"hi"},count:{type:ControlType.Number,defaultValue:1},mode:{type:ControlType.Enum,options:["a","b"],defaultValue:"a"},group:{type:ControlType.Object,controls:{flag:{type:ControlType.Boolean}}}});',
  'Widget.displayName="Widget";',
  'export const __FramerMetadata__ = {"exports":{}};',
  '//# sourceMappingURL=./Widget.map',
].join('\n')

const r = convertSource(FIXTURE, 'https://framer.com/m/Widget-prod-abc.js')

test('component name + filename', () => { eq(r.componentName, 'Widget'); eq(r.filename, 'Widget.tsx') })
test('dependencies detected (react excluded)', () => eq(r.dependencies, ['@react-three/drei', '@react-three/fiber', 'three', 'three-stdlib']))
test('imports split to correct packages', () => {
  contains(r.source, 'from "@react-three/fiber"')
  contains(r.source, 'from "@react-three/drei"')
  contains(r.source, 'from "three-stdlib"')
  contains(r.source, '} from "three"')
})
test('Canvas/useFrame grouped under fiber', () => contains(r.source, 'import { Canvas, useFrame } from "@react-three/fiber"'))
test('framer API fully stripped', () => {
  notContains(r.source, 'addPropertyControls')
  notContains(r.source, 'from "framer"')
  notContains(r.source, 'ControlType')
  notContains(r.source, '__FramerMetadata__')
  notContains(r.source, 'sourceMappingURL')
})
test('RenderTarget canvas-detection neutralized', () => {
  notContains(r.source, 'RenderTarget.current()')
  contains(r.source, 'const onCanvas=false')
})
test('Props interface generated from controls', () => {
  contains(r.source, 'export interface WidgetProps {')
  contains(r.source, 'label?: string')
  contains(r.source, 'count?: number')
  contains(r.source, 'mode?: "a" | "b"')
  contains(r.source, 'style?: CSSProperties')
})
test('nested ControlType.Object → nested type', () => contains(r.source, 'flag?: boolean'))
test('@ts-nocheck header present', () => contains(r.source, '// @ts-nocheck'))
test('install line lists deps', () => contains(r.source, '// Install: npm install @react-three/drei @react-three/fiber three three-stdlib'))
test('no warnings for clean component', () => eq(r.warnings, []))

// ── fallback: no addPropertyControls ──────────────────────────────────────────
console.log('\nconvertSource fallbacks:')
const NO_CONTROLS = 'import{jsx as _jsx}from"react/jsx-runtime";\nexport default function Plain({title,style}){return _jsx("div",{children:title});}'
const r2 = convertSource(NO_CONTROLS, 'https://framer.com/m/Plain-x.js')
test('props derived from params when no controls', () => {
  contains(r2.source, 'title?: any')
  contains(r2.source, 'style?: CSSProperties')
})
test('warns when controls missing', () => { if (!r2.warnings.some(w => /addPropertyControls/.test(w))) throw new Error('expected warning') })

// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
