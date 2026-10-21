import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { connectMcp } from '../src/host.ts'

// This test uses the exact pinned SDK with a real disposable stdio process.
test('official SDK connection, actual tool call, isolated retest and awaited teardown', { timeout: 25000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koishi-manager-host-'))
  const ctx = new Context()
  new SystemPrompt(ctx, { includeHarnessIdentity: false })
  const serverSections = async () => (await ctx.systemPrompt.assemble()).sections.filter(s => s.name === 'mcp:koishi_fixture')
  new ToolRuntime(ctx)
  const trace = join(dir, 'trace.jsonl')
  const config = { name: 'koishi_fixture', enabled: true, transport: 'stdio' as const, command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url)), trace] }
  const handles: Array<{ dispose(): Promise<void> }> = []
  try {
    const live = await connectMcp(ctx, config, { env: {}, headers: {} }, false); handles.push(live)
    assert.equal(live.toolCount(), 1)
    assert.ok(ctx.tools.get('mcp__koishi_fixture__ping'))
    assert.equal((await serverSections()).length, 1, 'real system prompt contains the active server instructions')
    const result = await ctx.tools.execute({ callId: 'fixture-call' as never, name: 'mcp__koishi_fixture__ping', arguments: { message: 'safe' }, signal: new AbortController().signal })
    assert.equal(result.isError, false)
    assert.match(JSON.stringify(result.content), /pong:safe/)
    const before = await readFile(trace, 'utf8')
    const probe = await connectMcp(ctx, config, { env: {}, headers: {} }, true); handles.push(probe)
    assert.equal(probe.toolCount(), 1)
    await probe.dispose()
    assert.ok(ctx.tools.get('mcp__koishi_fixture__ping'), 'probe teardown must preserve the live connection')
    assert.ok((await readFile(trace, 'utf8')).length > before.length, 'retest starts a real new process')
    await live.dispose()
    assert.equal(ctx.tools.get('mcp__koishi_fixture__ping'), undefined)
    assert.equal((await serverSections()).length, 0, 'no server instructions leak past disposal')
  } finally {
    for (const handle of handles.reverse()) await handle.dispose()
    await ctx.fiber.dispose()
    assert.ok(dir.startsWith(join(tmpdir(), 'koishi-manager-host-')))
    await rm(dir, { recursive: true, force: true })
  }
})
