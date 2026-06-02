#!/usr/bin/env node
/**
 * getframe MCP server
 *
 * Slash command:  /getframe <url>   (auto-exposed MCP prompt)
 *
 * The heavy lifting lives in convert.mjs (deterministic conversion) and cli.mjs
 * (writes files + installs deps). This server just exposes them to Claude Code.
 *
 * Setup: see README.md
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { convertFramerComponent, resolveModuleUrl, extractComponentName } from './convert.mjs'

const SERVER_DIR = dirname(fileURLToPath(import.meta.url))
const CLI_PATH = join(SERVER_DIR, 'cli.mjs')

// ─── PROMPT TEXT ──────────────────────────────────────────────────────────────
// The /getframe prompt's whole job is to make Claude run the CLI (which does
// fetch → convert → write files → install) and then patch any rare leftovers.

function buildPromptText(url) {
  return [
    `Convert the Framer component at this URL into working React and set it up so it runs:`,
    ``,
    `    ${url}`,
    ``,
    `## Step 1 — run the getframe CLI in the CURRENT project directory`,
    ``,
    `Run exactly this with the Bash tool (it fetches, converts, writes files, and installs deps):`,
    ``,
    `    node "${CLI_PATH}" "${url}"`,
    ``,
    `What it does automatically:`,
    `- Follows Framer's re-export stubs to the real component source.`,
    `- Repoints all Framer-CDN imports to real npm packages and installs them.`,
    `- Strips the Framer-only API (addPropertyControls / ControlType / RenderTarget) and`,
    `  generates a typed Props interface.`,
    `- If the current directory is a React project → writes ComponentName.tsx (+ a usage`,
    `  example) into the components dir and installs deps.`,
    `- Otherwise → scaffolds a runnable Vite + React + TS demo (its own folder) and installs it.`,
    ``,
    `## Step 2 — finish up`,
    ``,
    `- Read the generated component file. If it contains any \`getframe:UNRESOLVED\` markers,`,
    `  resolve them: map the flagged import to the correct npm package (or inline the source)`,
    `  and install anything missing.`,
    `- Report to the user: which files were written, what was installed, and how to run it`,
    `  (for a scaffolded demo: \`cd <folder> && npm run dev\`).`,
    ``,
    `Do not hand-rewrite the component — the CLI output is authoritative. Only touch it to`,
    `clear UNRESOLVED markers or fix an obvious compile error.`,
  ].join('\n')
}

// ─── SERVER ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'getframe', version: '3.0.0' },
  { capabilities: { tools: {}, prompts: {} } }
)

// ─── PROMPTS ──────────────────────────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'getframe',
      description: 'Fetch a Framer component and set it up as working React (writes files + installs deps). Usage: /getframe <url>',
      arguments: [
        {
          name: 'url',
          description: 'Framer component URL — a framer.com/m/... module URL, or a framer.university / Framer marketplace page URL',
          required: true,
        },
      ],
    },
  ],
}))

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  if (name !== 'getframe') {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${name}`)
  }
  const url = args?.url
  if (!url || typeof url !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'url argument is required. Usage: /getframe <url>')
  }
  return {
    messages: [
      { role: 'user', content: { type: 'text', text: buildPromptText(url) } },
    ],
  }
})

// ─── TOOLS ─────────────────────────────────────────────────────────────────--

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'convert_framer_component',
      description:
        'Fetches a Framer component and converts it to standalone React TypeScript. Returns the ' +
        'finished component source, the npm dependencies to install, a usage example, and any ' +
        'warnings — as JSON. Follows re-export stubs, remaps CDN imports to npm packages, strips ' +
        'the Framer-only API, and generates a typed Props interface. For the full file-writing + ' +
        'install flow prefer the /getframe prompt (which runs the getframe CLI).',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Framer component URL (framer.com/m/... or a framer.university/marketplace page URL)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'resolve_framer_url',
      description: 'Resolves a framer.university or marketplace page URL to its direct framer.com/m/ module URL.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Framer URL to resolve' } },
        required: ['url'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    if (name === 'convert_framer_component') {
      const { url } = args
      if (!url || typeof url !== 'string') throw new McpError(ErrorCode.InvalidParams, 'url is required')
      const r = await convertFramerComponent(url)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            componentName: r.componentName,
            filename: r.filename,
            dependencies: r.dependencies,
            installCommand: r.dependencies.length ? `npm install ${r.dependencies.join(' ')}` : null,
            warnings: r.warnings,
            usageExample: r.usageExample,
            source: r.source,
          }, null, 2),
        }],
      }
    }

    if (name === 'resolve_framer_url') {
      const { url } = args
      if (!url || typeof url !== 'string') throw new McpError(ErrorCode.InvalidParams, 'url is required')
      const moduleUrl = await resolveModuleUrl(url)
      const componentName = extractComponentName(moduleUrl)
      return {
        content: [{ type: 'text', text: `**Module URL:** ${moduleUrl}\n**Component name:** ${componentName}` }],
      }
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
  } catch (err) {
    if (err instanceof McpError) throw err
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
})

// ─── START ──────────────────────────────────────────────────────────────────--

const transport = new StdioServerTransport()
await server.connect(transport)
