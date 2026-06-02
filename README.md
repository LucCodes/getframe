# getframe-mcp

Turn any **Framer component** into a working, standalone **React + TypeScript** component —
fetched, converted, written to disk, and with its dependencies installed. Automatically.

**No Anthropic API key needed.** The conversion is deterministic (not AI-guessed): the Framer
module is already React, so getframe just rewires its dependencies — follows Framer's re-export
stubs to the real source, repoints Framer-CDN imports to real npm packages, strips the
Framer-only API (`addPropertyControls` / `ControlType` / `RenderTarget`), and generates a typed
`Props` interface.

Works in **any project/directory** once installed.

---

## What you get

Run it on a Framer component URL and getframe does the rest:

- **In a React project** → writes `ComponentName.tsx` (+ a usage example) into your components
  dir and installs the detected npm dependencies.
- **Anywhere else** → scaffolds a runnable **Vite + React + TypeScript** demo wired to the
  component, installs everything, and tells you `npm run dev`.

No manual steps, no copy-pasting, no hunting down which npm packages a CDN bundle maps to.

---

## Install

### Option A — Clone + `install.sh` (recommended)

```bash
git clone https://github.com/luccodes/getframe-mcp ~/scripts/getframe-mcp
cd ~/scripts/getframe-mcp
bash install.sh
```

`install.sh` resolves its own location (no hardcoded paths), installs deps, and registers the
MCP server with Claude Code at **user scope** — so getframe works in every project.

### Option B — npx (no clone, after publish)

```bash
claude mcp add getframe -- npx -y getframe-mcp
```

### Verify

```bash
claude mcp list           # should show: getframe
```

---

## Usage

### In Claude Code (the slash command)

getframe is exposed as an MCP prompt, so it appears automatically once registered:

```
/mcp__getframe__getframe https://framer.com/m/DepthGlobe-prod-5cOY4e.js
```

Claude runs the getframe CLI in your current project, which fetches → converts → writes files →
installs deps, then reports what was created and how to run it.

### As a CLI (no Claude needed)

```bash
getframe <framer-url> [--out <dir>] [--demo] [--no-install]
# e.g.
getframe https://framer.com/m/DepthGlobe-prod-5cOY4e.js
```

- `--out <dir>` — where to write the component in a React project (default: `src/components`).
- `--demo` — force scaffolding a standalone Vite demo even inside a React project.
- `--no-install` — write files but skip dependency installation.

### Getting the component URL

You need the Framer **module URL** (`https://framer.com/m/Name-XXXX.js`). How to get it:

| Source | How |
|---|---|
| framer.university | Click **"Copy component"** on a resource page |
| Framer editor | Assets panel → right-click component → **"Copy URL"** |
| Framer marketplace | Click **"Copy Component"** on a component page |

getframe also accepts a framer.university / marketplace **page** URL and scrapes it for the
module URL.

---

## How conversion works

1. **Resolve** the input to a `framer.com/m/...` module URL.
2. **Follow re-export stubs** — `*-prod-*.js` modules just `export * from` the real
   `framerusercontent.com` source; getframe follows the chain (with depth/cycle guards).
3. **Rewire imports** — `framer/motion` → `framer-motion`, `esm.sh/x` → `x`, and CDN bundles
   (e.g. `cdn.jsdelivr.net/gh/framer-university/...`) are **split** back into real npm imports
   via a symbol→package table (`@react-three/fiber`, `@react-three/drei`, `three`,
   `three-stdlib`, …). Unmappable imports get a `getframe:UNRESOLVED` marker for review.
4. **Strip Framer** — remove the `framer` import, the `addPropertyControls(...)` call, the
   `__FramerMetadata__` export, and neutralize `RenderTarget` canvas-detection.
5. **Generate Props** — build a typed `interface ComponentNameProps` from the property controls
   (Enum→union, nested `ControlType.Object`→nested type, etc.), falling back to the component's
   destructured params if no controls exist.
6. **Assemble** — emit the component with `// @ts-nocheck` on the machine-generated body but a
   fully typed public `Props` API, plus the npm dependency list.

---

## MCP Tools

### `convert_framer_component`
Fetches and converts a Framer component, returning JSON: `componentName`, `filename`,
`dependencies`, `installCommand`, `warnings`, `usageExample`, and the finished `source`. Use the
`/getframe` prompt for the full write-files-and-install flow.

### `resolve_framer_url`
Resolves any Framer URL to its direct `framer.com/m/` module URL + detected component name.

---

## Troubleshooting

**`getframe:UNRESOLVED` markers in the output** — an import couldn't be auto-mapped to an npm
package (an uncommon CDN bundle symbol, or a shared Framer sub-module). Map it to the right
package or inline its source; the warning lists exactly what.

**"Access denied (403)"** — premium component. Open it in Framer and use Assets → "Copy URL"
from within your project.

**`getframe` not showing in Claude Code** — run `claude mcp list`; if missing, re-run
`bash install.sh`. Restart Claude Code so a newly-registered server's prompt appears.

---

## Running tests

```bash
npm test          # node test-tools.mjs — offline conversion-core tests
```
