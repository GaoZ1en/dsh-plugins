/** Supported SDK bridge: deny-only tombstones in each live Agent's nearest skill layer. */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillCandidate, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { SkillPolicyStore } from './skill-policy.ts'

const PROVIDER = 'koishi-skill-policy'
interface Attachment { ready: Promise<void>; close(): Promise<void> }
async function quiesce(fiber: Fiber): Promise<void> {
  await fiber.dispose()
  while (fiber.inertia) await fiber.inertia
}

/**
 * Does not edit source files, rewrite prompt assembly, activate cold sessions, or wake Agents.
 * Each declared skills-dependency child fiber belongs to its Agent and to the manager's cleanup.
 * Await mounting so already-live Agents are protected before the manager reports successful startup.
 */
export async function mountSkillPolicy(ctx: Context, policy: SkillPolicyStore, options: { resolveCwd?: (cwd?: string) => string | undefined; mappingRevision?: () => string } = {}): Promise<() => Promise<void>> {
  policy.snapshot()
  const resolveCwd = options.resolveCwd ?? ((cwd?: string) => cwd)
  let active = true
  const registrations = new Map<Agent, Attachment>()
  const controls = new Set<SkillProviderControl>()
  let mappingRevision = options.mappingRevision?.()
  const invalidate = (): void => { for (const control of controls) if (!control.signal.aborted) control.invalidate() }
  const refreshMapping = (): void => {
    if (!options.mappingRevision) return
    const revision = options.mappingRevision()
    if (revision === mappingRevision) return
    mappingRevision = revision
    invalidate()
  }
  const isLive = (agent: Agent): boolean => active && agent.ctx.fiber.uid !== null && ctx.agents.get(agent.id) === agent
  const attach = async (agent: Agent): Promise<void> => {
    if (!isLive(agent)) return
    const previous = registrations.get(agent)
    if (previous) return previous.ready
    let dependency: (Fiber & PromiseLike<Fiber>) | undefined
    let releaseOwner: (() => Promise<void>) | undefined
    let closing: Promise<void> | undefined
    let installed = false
    const disposeChild = (): Promise<void> => closing ??= (async () => {
      try { if (dependency) await quiesce(dependency) }
      finally { if (registrations.get(agent) === entry) registrations.delete(agent) }
    })()
    const entry: Attachment = {
      ready: Promise.resolve(),
      close: async () => { await disposeChild(); if (releaseOwner) await releaseOwner() },
    }
    registrations.set(agent, entry)
    entry.ready = (async () => {
      try {
        // Agent.ctx intentionally has a narrow API. Declare this dependency rather than borrowing Host access.
        dependency = agent.ctx.inject(['skills'], scoped => {
          if (!active) return
          const remove = scoped.skills.registerProvider(control => {
            controls.add(control)
            // Service replacement aborts this provider, but must retain its reloadable injection-fiber entry.
            control.signal.addEventListener('abort', () => { controls.delete(control) }, { once: true })
            return {
              name: PROVIDER,
              async list(lookup) {
                lookup.signal?.throwIfAborted()
                if (!active || control.signal.aborted) return []
                const snapshot = policy.snapshot()
                const names = new Set(snapshot.rules.map(rule => rule.name))
                const cwd = resolveCwd(lookup.cwd)
                const candidates: SkillCandidate[] = []
                for (const name of names) if (!policy.isEnabled(name, cwd)) candidates.push({
                  name,
                  description: 'Disabled in DSH',
                  invocation: { modelInvocable: false, userInvocable: false },
                  source: 'custom',
                  provider: PROVIDER,
                  rank: -Number.MAX_VALUE,
                  locator: { name, revision: snapshot.revision },
                })
                return candidates
              },
              async get() { return undefined },
            }
          })
          installed = true
          scoped.effect(() => () => { installed = false }, 'koishi.skillPolicy.dependency')
          return remove
        })
        // The exact Agent also owns cleanup; manager unload independently awaits entry.close().
        releaseOwner = agent.ctx.effect(() => disposeChild, 'koishi.skillPolicy.agent')
        await dependency
        if (!isLive(agent)) { await entry.close(); return }
        if (!installed) throw new Error('Skill policy dependency did not become ready')
      } catch (error) {
        const skip = !isLive(agent)
        await entry.close()
        if (!skip) throw error
      }
    })()
    await entry.ready
  }
  const unsubscribe = policy.subscribe(invalidate)
  const off = ctx.on('agent/created', async ({ agent, signal }) => { signal?.throwIfAborted(); await attach(agent); signal?.throwIfAborted(); return undefined })
  const offDomain = ctx.on('domain/changed', change => { if (change.domain === 'workspace') invalidate() })
  const offStep = ctx.on('agent/pre-step', (_payload, next) => { refreshMapping(); return next() }, { prepend: true })
  const offTool = ctx.on('tools/pre-execute', (_execution, next) => { refreshMapping(); return next() }, { prepend: true })
  let cleanup: Promise<void> | undefined
  const dispose = (): Promise<void> => cleanup ??= (async () => {
    active = false
    off(); offDomain(); offStep(); offTool(); unsubscribe()
    const entries = [...registrations.values()]
    const results = await Promise.allSettled(entries.map(entry => entry.close()))
    registrations.clear(); controls.clear()
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  })()
  // Register the asynchronous cleanup before the first awaited attachment.
  const remove = ctx.effect(() => dispose, 'koishi.skillPolicy')
  try { for (const agent of ctx.agents.list()) await attach(agent) }
  catch (error) { await dispose(); await remove(); throw error }
  return async () => { await dispose(); await remove() }
}
