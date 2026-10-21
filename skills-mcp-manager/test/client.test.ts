import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMcpServer, emptyForm, refsText } from '../src/client/form.ts'
import { mcpCapabilities, skillCapabilities } from '../src/client/capabilities.ts'
import { en, zh } from '../src/client/locales.ts'
import type { Translate } from '../src/client/locales.ts'

const t: Translate = key => key
const stdioForm = () => ({ ...emptyForm(), name: 'example', command: 'example-mcp' })

test('blank optional stdio cwd is omitted from the wire payload', () => {
  for (const cwd of ['', ' ', '\t\n']) {
    const server = buildMcpServer({ ...stdioForm(), cwd }, t)
    assert.equal(Object.hasOwn(server, 'cwd'), false)
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(server)), 'cwd'), false)
    assert.equal(server.enabled, false)
    assert.equal(Object.hasOwn(server, 'id'), false)
  }
})

test('nonblank stdio cwd is trimmed and preserved', () => {
  const server = buildMcpServer({ ...stdioForm(), cwd: '  /Users/example/project  ' }, t)
  assert.equal(server.cwd, '/Users/example/project')
})

test('editing preserves stable identity and explicit enabled state, not list revision', () => {
  const server = buildMcpServer({ ...stdioForm(), id: 'stable-id', revision: 12, name: ' renamed ', enabled: true }, t)
  assert.equal(server.id, 'stable-id')
  assert.equal(server.name, 'renamed')
  assert.equal(server.enabled, true)
  assert.equal(Object.hasOwn(server, 'revision'), false)
})

test('stdio payload has only stdio fields and reference mappings', () => {
  const server = buildMcpServer({ ...stdioForm(), command: ' example-mcp ', args: '--first\n\nargument with spaces', envRefs: ' TOKEN = TOKEN_REFERENCE \n\nOTHER=OTHER_REFERENCE', url: 'https://unused.invalid', headerRefs: 'Authorization=UNUSED' }, t)
  assert.equal(server.command, 'example-mcp')
  assert.deepEqual(server.args, ['--first', 'argument with spaces'])
  assert.deepEqual({ ...server.envRefs }, { TOKEN: 'TOKEN_REFERENCE', OTHER: 'OTHER_REFERENCE' })
  assert.equal(Object.hasOwn(server, 'url'), false)
  assert.equal(Object.hasOwn(server, 'headerRefs'), false)
  assert.equal(Object.hasOwn(server, 'env'), false)
  assert.equal(Object.hasOwn(server, 'headers'), false)
})

test('HTTP payload excludes stdio fields and preserves literal header references', () => {
  const server = buildMcpServer({ ...stdioForm(), transport: 'streamable-http', url: ' https://example.invalid/mcp ', cwd: '/unused', envRefs: 'TOKEN=UNUSED', headerRefs: 'Authorization=FULL_HEADER_REFERENCE' }, t)
  assert.equal(server.url, 'https://example.invalid/mcp')
  assert.deepEqual({ ...server.headerRefs }, { Authorization: 'FULL_HEADER_REFERENCE' })
  for (const key of ['cwd', 'command', 'args', 'envRefs', 'env', 'headers']) assert.equal(Object.hasOwn(server, key), false)
})

test('reference mappings reject missing names, missing values and duplicate keys', () => {
  for (const envRefs of ['TOKEN', '=REF', 'TOKEN=', 'TOKEN=FIRST\nTOKEN=SECOND']) {
    assert.throws(() => buildMcpServer({ ...stdioForm(), envRefs }, t), { message: 'invalidRefs' })
  }
})

test('required name, command and HTTP URL are validated', () => {
  assert.throws(() => buildMcpServer({ ...stdioForm(), name: ' ' }, t), { message: 'required' })
  assert.throws(() => buildMcpServer({ ...stdioForm(), command: ' ' }, t), { message: 'required' })
  assert.throws(() => buildMcpServer({ ...stdioForm(), transport: 'streamable-http', url: ' ' }, t), { message: 'required' })
})

test('reference display text round-trips without exposing a separate secret-value field', () => {
  assert.equal(refsText(), '')
  const envRefs = { TOKEN: 'TOKEN_REFERENCE', OTHER: 'OTHER_REFERENCE' }
  const server = buildMcpServer({ ...stdioForm(), envRefs: refsText(envRefs) }, t)
  assert.deepEqual({ ...server.envRefs }, envRefs)
})

test('a source-readonly skill can switch DSH policy but cannot be trashed', () => {
  assert.deepEqual(skillCapabilities({ writable: false, toggleable: true, sourceEnabled: true }), {
    toggle: true, trash: false, sourceDisabled: false,
  })
})

test('source-level disable is reported without blocking DSH off-policy changes', () => {
  assert.deepEqual(skillCapabilities({ writable: false, toggleable: true, sourceEnabled: false }), {
    toggle: true, trash: false, sourceDisabled: true,
  })
})

test('explicit switch capability overrides source writability with legacy fallback', () => {
  assert.equal(skillCapabilities({ writable: true, toggleable: false }).toggle, false)
  assert.equal(skillCapabilities({ writable: true }).toggle, true)
  assert.equal(skillCapabilities({ writable: false }).toggle, false)
  assert.equal(skillCapabilities({ writable: true }).trash, true)
})

test('native MCP can switch without gaining edit or delete permissions', () => {
  assert.deepEqual(mcpCapabilities({ source: 'native', writable: false, toggleable: true }), {
    toggle: true, edit: false, remove: false,
  })
  assert.deepEqual(mcpCapabilities({ source: 'native', writable: false }), {
    toggle: false, edit: false, remove: false,
  })
})

test('MCP switch capability is independent and cleanup permits only removal retry', () => {
  assert.deepEqual(mcpCapabilities({ source: 'managed', writable: true, toggleable: false }), {
    toggle: false, edit: true, remove: true,
  })
  assert.deepEqual(mcpCapabilities({ source: 'managed', writable: true }), {
    toggle: true, edit: true, remove: true,
  })
  assert.deepEqual(mcpCapabilities({ source: 'managed', writable: true, toggleable: true, cleanupPending: true }), {
    toggle: false, edit: false, remove: true,
  })
})

test('both locales expose identical complete DSH-policy and source-permission copy', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const key of ['skillPolicyHint', 'toggleConfirm', 'sourceDisabledHint', 'readOnly', 'native', 'switchSupported'] as const) {
    assert.ok(en[key].length > 0)
    assert.ok(zh[key].length > 0)
  }
})
