#!/usr/bin/env node
/**
 * getframe CLI — fetch a Framer component and drop working files into your project.
 *
 *   getframe <framer-url> [--out <dir>] [--demo] [--no-install]
 *
 * Behaviour ("Both, smart"):
 *   • In a React project  → writes ComponentName.tsx (+ a usage example) into your
 *                            components dir and installs the detected npm deps.
 *   • Anywhere else        → scaffolds a runnable Vite + React + TS demo wired to the
 *                            component, installs everything, and tells you `npm run dev`.
 *
 * The component itself is produced by the deterministic engine in convert.mjs.
 */

import { convertFramerComponent } from './convert.mjs'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ─── Pinned, mutually-compatible versions for common Framer stacks ──────────────
const VERSIONS = {
  'three': '0.160.1',
  '@react-three/fiber': '8.17.10',
  '@react-three/drei': '9.114.0',
  'three-stdlib': '2.30.4',
  'framer-motion': '11.11.0',
  'gsap': '3.12.5',
  'lenis': '1.1.13',
}
const ver = (pkg) => VERSIONS[pkg] ?? 'latest'
const spec = (pkg) => `${pkg}@${ver(pkg)}`

// Scaffold devDeps for the Vite demo.
const DEMO_DEV = {
  'vite': '^5.4.0',
  '@vitejs/plugin-react': '^4.3.0',
  'typescript': '^5.5.0',
  '@types/react': '^18.3.0',
  '@types/react-dom': '^18.3.0',
}
const DEMO_REACT = { 'react': '^18.3.1', 'react-dom': '^18.3.1' }

// ─── helpers ────────────────────────────────────────────────────────────────--

function parseArgs(argv) {
  const args = { url: null, out: null, demo: false, install: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a === '--demo') args.demo = true
    else if (a === '--no-install') args.install = false
    else if (!a.startsWith('-') && !args.url) args.url = a
  }
  return args
}

function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

function detectPM(cwd) {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun'
  return 'npm'
}

function isReactProject(cwd) {
  const pkg = readJSON(join(cwd, 'package.json'))
  if (!pkg) return false
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  return Boolean(deps.react)
}

function addCmd(pm, specs) {
  const list = specs.join(' ')
  if (pm === 'npm') return `npm install ${list}`
  if (pm === 'yarn') return `yarn add ${list}`
  if (pm === 'pnpm') return `pnpm add ${list}`
  if (pm === 'bun') return `bun add ${list}`
  return `npm install ${list}`
}

function installAllCmd(pm) {
  return pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bun install' : `${pm} install`
}

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function write(file, content) {
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, content)
  console.log(`  wrote ${file}`)
}

function chooseComponentsDir(cwd, override) {
  if (override) return resolve(cwd, override)
  if (existsSync(join(cwd, 'src', 'components'))) return join(cwd, 'src', 'components')
  if (existsSync(join(cwd, 'components'))) return join(cwd, 'components')
  if (existsSync(join(cwd, 'src'))) return join(cwd, 'src', 'components')
  return join(cwd, 'components')
}

// ─── scaffold templates ─────────────────────────────────────────────────────--

function demoPackageJson(name, deps) {
  const dependencies = { ...DEMO_REACT }
  for (const d of deps) dependencies[d] = ver(d)
  return JSON.stringify({
    name: `getframe-${name}`,
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies,
    devDependencies: { ...DEMO_DEV },
  }, null, 2) + '\n'
}

const VITE_CONFIG = `import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({ plugins: [react()] })
`

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2020', useDefineForClassFields: true, lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    module: 'ESNext', skipLibCheck: true, moduleResolution: 'bundler',
    allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true,
    noEmit: true, jsx: 'react-jsx', strict: false,
  },
  include: ['src'],
}, null, 2) + '\n'

function indexHtml(componentName) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${componentName} — getframe</title>
    <style>html, body, #root { margin: 0; height: 100%; }</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

const MAIN_TSX = `import React from "react"
import { createRoot } from "react-dom/client"
import App from "./App"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`

function appTsx(componentName) {
  return `import ${componentName} from "./${componentName}"

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <${componentName} />
    </div>
  )
}
`
}

// ─── main ─────────────────────────────────────────────────────────────────--

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.url) {
    console.error('Usage: getframe <framer-url> [--out <dir>] [--demo] [--no-install]')
    process.exit(1)
  }

  const cwd = process.cwd()
  console.log(`getframe → ${args.url}`)
  const result = await convertFramerComponent(args.url)
  const { componentName, filename, source, dependencies, usageExample, warnings } = result

  const reactHere = isReactProject(cwd) && !args.demo

  if (reactHere) {
    // ── Drop into the existing React project ──────────────────────────────────
    const pm = detectPM(cwd)
    const outDir = chooseComponentsDir(cwd, args.out)
    write(join(outDir, filename), source)
    write(join(outDir, `${componentName}.usage.tsx`), usageExample)
    if (args.install && dependencies.length) {
      run(addCmd(pm, dependencies.map(spec)), cwd)
    }
    console.log(`\n✅  ${componentName} added to ${outDir}`)
    if (!args.install && dependencies.length) console.log(`   Install deps: ${addCmd(pm, dependencies.map(spec))}`)
    console.log(`   Import it:    import ${componentName} from "${join(outDir, componentName).replace(cwd + '/', './')}"`)
  } else {
    // ── Scaffold a standalone runnable Vite demo ──────────────────────────────
    const dir = join(cwd, `getframe-${kebab(componentName)}`)
    write(join(dir, 'package.json'), demoPackageJson(kebab(componentName), dependencies))
    write(join(dir, 'vite.config.ts'), VITE_CONFIG)
    write(join(dir, 'tsconfig.json'), TSCONFIG)
    write(join(dir, 'index.html'), indexHtml(componentName))
    write(join(dir, 'src', 'main.tsx'), MAIN_TSX)
    write(join(dir, 'src', 'App.tsx'), appTsx(componentName))
    write(join(dir, 'src', filename), source)
    if (args.install) run(installAllCmd('npm'), dir)
    console.log(`\n✅  Runnable demo scaffolded at ${dir}`)
    console.log(`   cd getframe-${kebab(componentName)} && ${args.install ? 'npm run dev' : 'npm install && npm run dev'}`)
  }

  if (warnings.length) {
    console.log(`\n⚠  ${warnings.length} warning(s):`)
    for (const w of warnings) console.log(`   - ${w}`)
    console.log(`   (search the component for "getframe:UNRESOLVED" markers)`)
  }
}

main().catch((err) => {
  console.error(`\n❌  ${err.message}`)
  process.exit(1)
})
