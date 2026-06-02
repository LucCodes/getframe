/**
 * getframe — conversion core
 *
 * Deterministic Framer → standalone React TypeScript conversion. No AI, no API key.
 * The Framer module is ALREADY React; this only rewires dependencies:
 *   1. follow re-export stubs to the real source
 *   2. repoint Framer-CDN imports to real npm packages
 *   3. strip the Framer-only API (addPropertyControls / ControlType / RenderTarget)
 *   4. generate a typed Props interface from the property controls
 *
 * Exports: convertFramerComponent(url) -> { componentName, filename, source,
 *          dependencies[], usageExample, warnings[], moduleUrl }
 */

import { Parser } from 'acorn'

// ─── URL PATTERNS ─────────────────────────────────────────────────────────────

const MODULE_URL_REGEX = /https:\/\/framer\.com\/m\/[A-Za-z0-9_-]+\.js(?:@[A-Za-z0-9]+)?/

// ─── CDN bundle symbol → npm package map (first match wins) ─────────────────────
// Framer University and similar publishers bundle several npm libs into ONE browser
// ESM file. We split that import back into real npm imports by symbol name.

const DREI = new Set([
  'OrbitControls', 'MapControls', 'TrackballControls', 'ArcballControls', 'TransformControls',
  'PerspectiveCamera', 'OrthographicCamera', 'CameraControls', 'CubeCamera',
  'Environment', 'Lightformer', 'Sky', 'Stars', 'Cloud', 'Clouds', 'Sparkles',
  'ContactShadows', 'AccumulativeShadows', 'RandomizedLight', 'SoftShadows', 'BakeShadows',
  'Html', 'Text', 'Text3D', 'Billboard', 'Image', 'ScreenSpace', 'Mask',
  'useGLTF', 'useTexture', 'useFBX', 'useAnimations', 'useCubeTexture', 'useProgress',
  'useScroll', 'useHelper', 'useDepthBuffer', 'useFBO', 'useMatcapTexture', 'useEnvironment',
  'Loader', 'shaderMaterial', 'MeshTransmissionMaterial', 'MeshWobbleMaterial',
  'MeshDistortMaterial', 'MeshReflectorMaterial', 'MeshRefractionMaterial',
  'Float', 'Center', 'Bounds', 'Resize', 'ScrollControls', 'Scroll', 'PresentationControls',
  'Stage', 'Grid', 'GizmoHelper', 'GizmoViewport', 'Stats', 'StatsGl', 'Effects',
  'Edges', 'Outlines', 'Wireframe', 'Line', 'QuadraticBezierLine', 'CubicBezierLine',
  'RoundedBox', 'Sphere', 'Box', 'Plane', 'Torus', 'Cylinder', 'Cone', 'Circle',
  'Ring', 'Tube', 'Dodecahedron', 'Icosahedron', 'Octahedron', 'Tetrahedron',
  'Backdrop', 'Shadow', 'Caustics', 'Reflector', 'MarchingCubes', 'Detailed',
  'Instances', 'Instance', 'Merged', 'Trail', 'useTrail', 'Sampler', 'ComputedAttribute',
])

const FIBER = new Set([
  'Canvas', 'useFrame', 'useThree', 'useLoader', 'useGraph', 'extend', 'createPortal',
  'invalidate', 'advance', 'addEffect', 'addAfterEffect', 'addTail', 'applyProps',
  'useInstanceHandle', 'useStore', 'flushSync', 'events', 'context', 'dispose',
])

const STDLIB = new Set([
  'EffectComposer', 'RenderPass', 'ShaderPass', 'UnrealBloomPass', 'OutputPass',
  'SMAAPass', 'SSAOPass', 'SAOPass', 'BokehPass', 'FilmPass', 'GlitchPass', 'AfterimagePass',
  'HalftonePass', 'MaskPass', 'ClearPass', 'TexturePass', 'GTAOPass', 'TAARenderPass',
  'GLTFLoader', 'DRACOLoader', 'RGBELoader', 'EXRLoader', 'KTX2Loader', 'FBXLoader',
  'OBJLoader', 'MTLLoader', 'SVGLoader', 'FontLoader', 'TextGeometry', 'STLLoader',
  'MeshSurfaceSampler', 'GroundProjectedSkybox', 'RoomEnvironment', 'FullScreenQuad',
  'CopyShader', 'FXAAShader', 'LUTPass', 'Water', 'Sky2', 'GammaCorrectionShader',
  'LuminosityHighPassShader', 'SSRPass', 'RenderPixelatedPass',
])

// Bare specifiers that map to a fixed npm package regardless of source path.
function resolveBundleSymbol(name) {
  if (DREI.has(name)) return '@react-three/drei'
  if (FIBER.has(name)) return '@react-three/fiber'
  if (STDLIB.has(name)) return 'three-stdlib'
  return 'three' // default: the overwhelming majority of remaining symbols are three classes
}

// Packages that are peers / always present — never added to the install list.
const PEER_PKGS = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'framer'])

// ─── FETCH ──────────────────────────────────────────────────────────────────--

async function fetchText(url, { timeout = 15000 } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; getframe-mcp/1.0)',
      'Accept': 'application/javascript, text/javascript, text/html, */*',
    },
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) {
    const hint =
      res.status === 404 ? 'Component not found — URL may be wrong or deleted.' :
      res.status === 403 ? 'Access denied — this component may require a Framer account.' :
      `HTTP ${res.status} ${res.statusText}`
    throw new Error(`Fetch failed for ${url}: ${hint}`)
  }
  return res.text()
}

async function resolveModuleUrl(inputUrl) {
  if (MODULE_URL_REGEX.test(inputUrl)) return inputUrl
  const html = await fetchText(inputUrl, { timeout: 10000 })
  const match = html.match(MODULE_URL_REGEX)?.[0]
  if (match) return match
  throw new Error(
    `No Framer module URL found in: ${inputUrl}\n` +
    `Pass the direct module URL (framer.com/m/Name-XXXX.js) — e.g. "Copy component" on ` +
    `framer.university, or Assets → "Copy URL" in the Framer editor.`
  )
}

function parse(source) {
  return Parser.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: false })
}

function absolutize(url, base) {
  try { return new URL(url, base).href } catch { return url }
}

// ─── STUB FOLLOWING ─────────────────────────────────────────────────────────--
// `*-prod-*.js` modules are thin re-export stubs pointing at the real framerusercontent
// module. Follow `export * from "X"` / `export {default} from "X"` chains to the source.

function findReExportTarget(source) {
  let ast
  try { ast = parse(source) } catch { return null }
  let starFrom = null
  let onlyExportFroms = true
  let sawExportFrom = false
  for (const node of ast.body) {
    if (node.type === 'ExportAllDeclaration' && node.source) {
      sawExportFrom = true
      if (!starFrom) starFrom = node.source.value
    } else if (node.type === 'ExportNamedDeclaration' && node.source) {
      sawExportFrom = true
    } else if (node.type === 'EmptyStatement') {
      // ignore
    } else {
      onlyExportFroms = false
    }
  }
  // A stub re-exports a namespace and contains no real code of its own.
  if (starFrom) return starFrom
  if (sawExportFrom && onlyExportFroms) {
    const named = ast.body.find(n => n.type === 'ExportNamedDeclaration' && n.source)
    return named?.source?.value ?? null
  }
  return null
}

async function followReExports(moduleUrl) {
  const seen = new Set()
  let url = moduleUrl
  for (let depth = 0; depth < 6; depth++) {
    if (seen.has(url)) throw new Error(`Re-export cycle detected at ${url}`)
    seen.add(url)
    const source = await fetchText(url)
    if (source.length < 60) throw new Error(`Response too small to be a component: ${url}`)
    const target = findReExportTarget(source)
    if (!target) return { source, url }
    url = absolutize(target, url)
  }
  throw new Error('Too many re-export hops (>6) — giving up.')
}

// ─── COMPONENT NAME ─────────────────────────────────────────────────────────--

function extractComponentName(moduleUrl) {
  const match = moduleUrl.match(/\/m\/([A-Z][a-zA-Z0-9]*)[-_]/)
  if (match) return match[1]
  const basename = moduleUrl.split('/').pop()?.split('.')[0] ?? 'Component'
  return basename.split('-')[0].replace(/[^A-Za-z0-9]/g, '') || 'FramerComponent'
}

// ─── IMPORT CLASSIFICATION ────────────────────────────────────────────────────

function esmShPackage(url) {
  // https://esm.sh/three@0.160.0  ->  three ; .../react@18/jsx-runtime -> react/jsx-runtime
  const m = url.match(/esm\.sh\/(?:v\d+\/)?((?:@[^/@]+\/)?[^@/]+)(?:@[^/]+)?(\/[^?#"']*)?/)
  if (!m) return null
  return m[1] + (m[2] || '')
}

// kind: 'bare' | 'pkg' | 'split' | 'drop' | 'unresolved'
function classifyImportSource(src) {
  if (!/:\/\//.test(src)) {
    return src === 'framer' ? { kind: 'drop' } : { kind: 'bare', pkg: src }
  }
  if (/framer\.com\/m\/framer\/motion/.test(src)) return { kind: 'pkg', pkg: 'framer-motion' }
  if (/framer\.com\/m\/framer\/react/.test(src)) return { kind: 'pkg', pkg: 'react' }
  if (/framer\.com\/m\/framer\//.test(src)) return { kind: 'unresolved', pkg: src }
  if (/esm\.sh\//.test(src)) {
    const pkg = esmShPackage(src)
    return pkg ? { kind: 'pkg', pkg } : { kind: 'unresolved', pkg: src }
  }
  if (/framerusercontent\.com\/modules\//.test(src)) return { kind: 'unresolved', pkg: src }
  // Any other remote URL = a bundled CDN module → split by symbol.
  return { kind: 'split', pkg: src }
}

// ─── IMPORT REWRITING ──────────────────────────────────────────────────────--
// Collect every ImportDeclaration, classify it, and rebuild one clean grouped block.

function collectImports(ast, warnings) {
  // pkg -> { defaults:Set, namespaces:Set, named:Map(local -> imported) }
  const byPkg = new Map()
  const ranges = []
  const ensure = (pkg) => {
    if (!byPkg.has(pkg)) byPkg.set(pkg, { defaults: new Set(), namespaces: new Set(), named: new Map() })
    return byPkg.get(pkg)
  }

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    ranges.push([node.start, node.end])
    const cls = classifyImportSource(node.source.value)
    if (cls.kind === 'drop') continue
    if (cls.kind === 'unresolved') {
      const names = node.specifiers.map(s => s.local.name).join(', ')
      warnings.push(`Unresolved import "${cls.pkg}" (used: ${names}); left as-is for review.`)
      // Keep it importing from the original URL so the symbols still resolve at runtime
      // in browser-ESM contexts, and so the user/Claude can see what to fix.
      ensure(`/* getframe:UNRESOLVED */ ${node.source.value}`)
      // fallthrough: register specifiers under the marker "package"
      const bucket = byPkg.get(`/* getframe:UNRESOLVED */ ${node.source.value}`)
      for (const s of node.specifiers) registerSpecifier(bucket, s)
      continue
    }
    if (cls.kind === 'split') {
      for (const s of node.specifiers) {
        if (s.type === 'ImportSpecifier') {
          const pkg = resolveBundleSymbol(s.imported.name)
          registerSpecifier(ensure(pkg), s)
        } else {
          warnings.push(`Default/namespace import from CDN bundle ${cls.pkg} could not be auto-mapped (${s.local.name}).`)
          registerSpecifier(ensure(`/* getframe:UNRESOLVED */ ${node.source.value}`), s)
        }
      }
      continue
    }
    // bare or pkg
    const bucket = ensure(cls.pkg)
    for (const s of node.specifiers) registerSpecifier(bucket, s)
  }
  return { byPkg, ranges }
}

function registerSpecifier(bucket, s) {
  if (s.type === 'ImportDefaultSpecifier') bucket.defaults.add(s.local.name)
  else if (s.type === 'ImportNamespaceSpecifier') bucket.namespaces.add(s.local.name)
  else if (s.type === 'ImportSpecifier') bucket.named.set(s.local.name, s.imported.name)
}

function renderImportBlock(byPkg) {
  // Stable, readable ordering: jsx-runtime, react, scoped/three stack, then the rest.
  const order = (p) =>
    p === 'react/jsx-runtime' ? 0 :
    p === 'react' ? 1 :
    p === 'three' ? 2 :
    p.startsWith('@react-three/') ? 3 :
    p === 'three-stdlib' ? 4 :
    p.startsWith('/* getframe:UNRESOLVED */') ? 99 : 10
  const pkgs = [...byPkg.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b))

  const lines = []
  for (const pkg of pkgs) {
    const { defaults, namespaces, named } = byPkg.get(pkg)
    const from = pkg.startsWith('/* getframe:UNRESOLVED */')
      ? pkg.replace('/* getframe:UNRESOLVED */ ', '')
      : pkg
    const marker = pkg.startsWith('/* getframe:UNRESOLVED */') ? ' // getframe:UNRESOLVED — verify this import' : ''
    const namedParts = [...named.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([local, imported]) => (local === imported ? imported : `${imported} as ${local}`))

    for (const ns of namespaces) lines.push(`import * as ${ns} from "${from}"${marker}`)
    if (defaults.size || namedParts.length) {
      const head = [...defaults][0]
      const namedStr = namedParts.length ? `{ ${namedParts.join(', ')} }` : ''
      const clause = [head, namedStr].filter(Boolean).join(', ')
      lines.push(`import ${clause} from "${from}"${marker}`)
      // extra defaults (rare) on their own lines
      for (const d of [...defaults].slice(1)) lines.push(`import ${d} from "${from}"`)
    }
  }
  return lines.join('\n')
}

function dependencyList(byPkg) {
  const deps = new Set()
  for (const pkg of byPkg.keys()) {
    if (pkg.startsWith('/* getframe:UNRESOLVED */')) continue
    if (PEER_PKGS.has(pkg)) continue
    // bare subpaths (three/examples/...) → root package
    const root = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0]
    if (PEER_PKGS.has(root)) continue
    deps.add(root)
  }
  return [...deps].sort()
}

// ─── PROPS GENERATION ──────────────────────────────────────────────────────--

const CONTROLTYPE_TS = {
  String: 'string', Color: 'string', Image: 'string', File: 'string', RichText: 'string',
  Number: 'number', Boolean: 'boolean', Date: 'string', Link: 'string', PageLink: 'string',
  Array: 'any[]', ComponentInstance: 'ReactNode', ResponsiveImage: 'string',
  EventHandler: '() => void', Transition: 'any', Font: 'any', Padding: 'string', BorderRadius: 'string',
}

function litValue(node) {
  if (!node) return undefined
  if (node.type === 'Literal') return node.value
  if (node.type === 'UnaryExpression' && node.argument.type === 'Literal') {
    return node.operator === '-' ? -node.argument.value : node.argument.value
  }
  return undefined
}

function objProp(objExpr, key) {
  if (!objExpr || objExpr.type !== 'ObjectExpression') return undefined
  return objExpr.properties.find(p => p.type === 'Property' && (p.key.name === key || p.key.value === key))?.value
}

function controlTypeName(ctrlObj) {
  const t = objProp(ctrlObj, 'type')
  if (t?.type === 'MemberExpression') return t.property.name // ControlType.Enum -> "Enum"
  return undefined
}

// Returns { ts, used:{ReactNode,CSSProperties} }
function tsTypeForControl(ctrlObj, used, indent) {
  const type = controlTypeName(ctrlObj)
  if (type === 'Enum') {
    const opts = objProp(ctrlObj, 'options')
    if (opts?.type === 'ArrayExpression') {
      const vals = opts.elements.map(litValue).filter(v => typeof v === 'string')
      if (vals.length) return vals.map(v => JSON.stringify(v)).join(' | ')
    }
    return 'string'
  }
  if (type === 'Object') {
    const controls = objProp(ctrlObj, 'controls')
    if (controls?.type === 'ObjectExpression') {
      const inner = renderInterfaceBody(controls, used, indent + '  ')
      return `{\n${inner}\n${indent}}`
    }
    return 'Record<string, any>'
  }
  const ts = CONTROLTYPE_TS[type] ?? 'any'
  if (ts === 'ReactNode') used.ReactNode = true
  return ts
}

function renderInterfaceBody(controlsObj, used, indent) {
  const lines = []
  for (const prop of controlsObj.properties) {
    if (prop.type !== 'Property') continue
    const name = prop.key.name ?? prop.key.value
    const ts = tsTypeForControl(prop.value, used, indent)
    lines.push(`${indent}${name}?: ${ts}`)
  }
  return lines.join('\n')
}

function defaultExportParamNames(ast) {
  const def = ast.body.find(n => n.type === 'ExportDefaultDeclaration')
  const fn = def?.declaration
  if (!fn || (fn.type !== 'FunctionDeclaration' && fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return { names: [], paramNode: null }
  const p0 = fn.params?.[0]
  if (!p0 || p0.type !== 'ObjectPattern') return { names: [], paramNode: p0 ?? null }
  const names = p0.properties
    .filter(pr => pr.type === 'Property')
    .map(pr => pr.key.name ?? pr.key.value)
  return { names, paramNode: p0, fnName: fn.id?.name }
}

function generateProps(ast, componentName, controlsObj, warnings) {
  const used = { ReactNode: false, CSSProperties: false }
  const { names: paramNames } = defaultExportParamNames(ast)
  let body
  try {
    if (controlsObj?.type === 'ObjectExpression' && controlsObj.properties.length) {
      body = renderInterfaceBody(controlsObj, used, '  ')
      // Add any destructured params not represented in controls (e.g. style).
      const covered = new Set(controlsObj.properties.map(p => p.key.name ?? p.key.value))
      for (const n of paramNames) {
        if (covered.has(n)) continue
        if (n === 'style') { body += `\n  style?: CSSProperties`; used.CSSProperties = true }
        else body += `\n  ${n}?: any`
      }
    } else throw new Error('no controls')
  } catch {
    // Fallback: derive from destructured params, else permissive.
    if (paramNames.length) {
      body = paramNames.map(n => {
        if (n === 'style') { used.CSSProperties = true; return `  style?: CSSProperties` }
        return `  ${n}?: any`
      }).join('\n')
    } else {
      body = '  [key: string]: any'
    }
    warnings.push('Could not parse addPropertyControls — Props derived from component parameters (loosely typed).')
  }
  if (paramNames.includes('style') && !/style\?:/.test(body)) { body += `\n  style?: CSSProperties`; used.CSSProperties = true }
  const iface = `export interface ${componentName}Props {\n${body}\n}`
  return { iface, used }
}

// ─── FRAMER STRIP + ASSEMBLE ────────────────────────────────────────────────--

function findAddPropertyControls(ast) {
  for (const node of ast.body) {
    if (node.type === 'ExpressionStatement' &&
        node.expression.type === 'CallExpression' &&
        node.expression.callee.type === 'Identifier' &&
        node.expression.callee.name === 'addPropertyControls') {
      return { range: [node.start, node.end], controls: node.expression.arguments[1] }
    }
  }
  return null
}

function findFramerMetadata(ast) {
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration') {
      const d = node.declaration.declarations[0]
      if (d?.id?.name === '__FramerMetadata__') return [node.start, node.end]
    }
  }
  return null
}

function applyEdits(src, edits) {
  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + (e.replacement ?? '') + out.slice(e.end)
  return out
}

// ─── MAIN ─────────────────────────────────────────────────────────────────--

export async function convertFramerComponent(inputUrl) {
  const moduleUrl = await resolveModuleUrl(inputUrl)
  const { source } = await followReExports(moduleUrl)
  return convertSource(source, moduleUrl)
}

/** Pure conversion of already-fetched, stub-resolved source. Network-free (unit-testable). */
export function convertSource(source, moduleUrl) {
  const warnings = []
  const componentName = extractComponentName(moduleUrl)

  let ast
  try { ast = parse(source) }
  catch (err) { throw new Error(`Could not parse component source as a module: ${err.message}`) }

  const { byPkg, ranges } = collectImports(ast, warnings)
  const importBlock = renderImportBlock(byPkg)
  const dependencies = dependencyList(byPkg)

  const apc = findAddPropertyControls(ast)
  const { iface, used } = generateProps(ast, componentName, apc?.controls, warnings)

  // Build edits over the ORIGINAL source positions (applied in one pass).
  const edits = []
  for (const [start, end] of ranges) edits.push({ start, end, replacement: '' })
  if (apc) edits.push({ start: apc.range[0], end: apc.range[1], replacement: '' })
  const meta = findFramerMetadata(ast)
  if (meta) edits.push({ start: meta[0], end: meta[1], replacement: '' })
  // Type the default-export param.
  const { paramNode } = defaultExportParamNames(ast)
  if (paramNode) edits.push({ start: paramNode.end, end: paramNode.end, replacement: `: ${componentName}Props` })

  let body = applyEdits(source, edits)

  // Neutralize Framer canvas-detection and drop sourcemap trailer.
  body = body
    .replace(/RenderTarget\.current\(\)\s*===\s*RenderTarget\.canvas/g, 'false')
    .replace(/RenderTarget\.current\(\)\s*!==\s*RenderTarget\.canvas/g, 'true')
    .replace(/^\s*\/\/# sourceMappingURL=.*$/m, '')
    .trim()

  if (/\bRenderTarget\b/.test(body)) warnings.push('Residual `RenderTarget` reference — review canvas-detection logic.')
  if (/from\s*["']framer["']/.test(body)) warnings.push('Residual import from "framer" — review.')

  const reactTypeImport = (used.ReactNode || used.CSSProperties)
    ? `import type { ${[used.CSSProperties && 'CSSProperties', used.ReactNode && 'ReactNode'].filter(Boolean).join(', ')} } from "react"\n`
    : ''

  const header =
    `// @ts-nocheck\n` +
    `// Converted from Framer by getframe — ${moduleUrl}\n` +
    (dependencies.length ? `// Install: npm install ${dependencies.join(' ')}\n` : '') +
    (warnings.length ? warnings.map(w => `// ⚠ ${w}`).join('\n') + '\n' : '') +
    `//\n` +
    `// @ts-nocheck is intentional: the body is Framer's machine-generated bundle. The public\n` +
    `// API is typed via ${componentName}Props below, so consumers still get IntelliSense.\n\n`

  const finalSource =
    header + importBlock + '\n' + reactTypeImport + '\n' + iface + '\n\n' + body + '\n'

  const usageExample =
    `import ${componentName} from "./${componentName}"\n\n` +
    `export default function Example() {\n` +
    `  return (\n` +
    `    <div style={{ width: "100vw", height: "100vh" }}>\n` +
    `      <${componentName} />\n` +
    `    </div>\n` +
    `  )\n` +
    `}\n`

  return {
    componentName,
    filename: `${componentName}.tsx`,
    source: finalSource,
    dependencies,
    usageExample,
    warnings,
    moduleUrl,
  }
}

export { resolveModuleUrl, extractComponentName }

// Exported for unit tests.
export const __test__ = {
  classifyImportSource, resolveBundleSymbol, esmShPackage, findReExportTarget,
  extractComponentName, collectImports, renderImportBlock, dependencyList,
  findAddPropertyControls, generateProps, parse, applyEdits, findFramerMetadata,
}
