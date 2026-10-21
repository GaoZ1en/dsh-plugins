import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SkillsMcpApi } from './api.ts'
import type { ImportResult, McpList, McpServerSummary, ScannedSkill, SkillDetail, SkillSummary } from '../protocol.ts'
import { buildMcpServer, emptyForm, refsText, type McpForm } from './form.ts'
import { mcpCapabilities, skillCapabilities } from './capabilities.ts'
import type { SkillsMcpKey, Translate } from './locales.ts'
import css from './settings-card.module.css'

const api = new SkillsMcpApi()
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Ignore superseded responses and responses arriving after unmount. */
function useResource<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<{ value?: T; loading: boolean; error: string }>({ loading: true, error: '' })
  const serial = useRef(0)
  const reload = useCallback(async () => {
    const request = ++serial.current
    setState(previous => ({ ...previous, loading: true, error: '' }))
    try {
      const value = await loader()
      if (request === serial.current) setState({ value, loading: false, error: '' })
    } catch (error) {
      if (request === serial.current) setState({ loading: false, error: errorText(error) })
    }
  }, [loader])
  useEffect(() => { void reload(); return () => { serial.current++ } }, [reload])
  return { ...state, reload }
}

function useOperation() {
  const lock = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true); setMessage('')
    try { await operation() }
    catch (error) { if (mounted.current) setMessage(errorText(error)) }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  return { busy, message, setMessage, run }
}

export function SkillsMcpManager({ t, pickDirectory }: { t: Translate; pickDirectory: () => Promise<string | null> }) {
  const [tab, setTab] = useState<'skills' | 'mcp'>('skills')
  const [cwd, setCwd] = useState('')
  const workspaces = useResource(useCallback(() => api.workspaces(), []))
  return <div className={css.manager}>
    <div className={css.tabs} role="tablist" aria-label={t('title')}>
      {(['skills', 'mcp'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab === key}
        className={tab === key ? css.tabActive : css.tab} onClick={() => setTab(key)}>{t(key)}</button>)}
    </div>
    {tab === 'skills' ? <>
      <label className={css.fieldLabel}><span>{t('workspace')}</span>
        <select className={css.input} value={cwd} onChange={event => setCwd(event.target.value)}>
          <option value="">{t('global')}</option>
          {(workspaces.value || []).map(workspace => <option key={workspace.id} value={workspace.path}>{workspace.title} · {workspace.path}</option>)}
        </select>
      </label>
      <p className={css.note}>{t('workspaceHint')}</p>
      {workspaces.error ? <ErrorMessage message={workspaces.error} t={t} /> : null}
      <button className={css.btn} type="button" disabled={workspaces.loading} onClick={() => void workspaces.reload()}>{t('refresh')} · {t('workspace')}</button>
      <SkillsPanel key={cwd} cwd={cwd} t={t} pickDirectory={pickDirectory} />
    </> : <McpPanel t={t} />}
  </div>
}

function SkillsPanel({ cwd, t, pickDirectory }: { cwd: string; t: Translate; pickDirectory: () => Promise<string | null> }) {
  const skills = useResource(useCallback(() => api.listSkills(cwd), [cwd]))
  const trash = useResource(useCallback(() => api.listTrash(cwd), [cwd]))
  const op = useOperation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [detail, setDetail] = useState<{ id: string; value?: SkillDetail; error?: string } | null>(null)
  const detailSerial = useRef(0)
  useEffect(() => () => { detailSerial.current++ }, [])
  const [dir, setDir] = useState('')
  const [scanned, setScanned] = useState<ScannedSkill[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<ImportResult[]>([])
  const refresh = async () => {
    detailSerial.current++
    setDetail(null)
    await Promise.all([skills.reload(), trash.reload()])
  }
  const view = async (skill: SkillSummary) => {
    const request = ++detailSerial.current
    if (detail?.id === skill.id) { setDetail(null); return }
    setDetail({ id: skill.id })
    try {
      const value = await api.readSkill(cwd, skill)
      if (request === detailSerial.current) setDetail({ id: skill.id, value })
    } catch (error) { if (request === detailSerial.current) setDetail({ id: skill.id, error: errorText(error) }) }
  }
  const changeDir = (value: string) => { setDir(value); setScanned(null); setSelected(new Set()); setResults([]) }
  const items = (skills.value || []).filter(skill => skill.name.toLowerCase().includes(query.trim().toLowerCase())
    && (filter === 'all' || (filter === 'enabled') === skill.enabled))
  return <div className={css.panel}>
    <section className={css.section}>
      <div className={css.inline}><h3 className={css.hGrow}>{t('skills')}</h3>
        <button type="button" className={css.btn} disabled={op.busy || skills.loading} onClick={() => void refresh()}>{t('refresh')}</button></div>
      <p className={css.note}>{t('skillPolicyHint')}</p>
      <div className={css.inline}>
        <input className={css.inputGrow} aria-label={t('search')} placeholder={t('search')} value={query} onChange={e => setQuery(e.target.value)} />
        <select className={css.filterSelect} aria-label={t('enabled')} value={filter} onChange={e => setFilter(e.target.value)}>
          {(['all', 'enabled', 'disabled'] as const).map(key => <option key={key} value={key}>{t(key)}</option>)}
        </select>
      </div>
      <ErrorMessage message={op.message || skills.error} t={t} />
      {skills.loading ? <p role="status">{t('loading')}</p> : items.length === 0 ? <p>{t('empty')}</p> : items.map(skill => {
        const capabilities = skillCapabilities(skill)
        return <Fragment key={skill.id}>
        <div className={css.row}>
          <div className={css.main}><div className={css.name}>{skill.name}</div>
            <div className={css.desc}>{skill.description}</div>
            <div className={css.note}>{t(skill.level)} · {skill.source} · {skill.path}</div>
            {!skill.writable ? <div className={css.note}>{t('readOnly')}{skill.readOnlyReason ? ` · ${skill.readOnlyReason}` : ''}</div> : null}
            {capabilities.sourceDisabled ? <div className={css.note}>{t('sourceDisabledHint')}</div> : null}
          </div>
          <label className={css.switch}>
            <input type="checkbox" role="switch" aria-checked={skill.enabled} aria-label={`${t('dshEnabled')} · ${skill.name}`} checked={skill.enabled} disabled={op.busy || !capabilities.toggle}
              onChange={() => {
                if (!capabilities.toggle || !window.confirm(t('toggleConfirm'))) return
                void op.run(async () => { await api.toggleSkill(cwd, skill, !skill.enabled); setDetail(null); await refresh() })
              }} /><span>{t(skill.enabled ? 'dshEnabled' : 'dshDisabled')}</span>
          </label>
          <button className={css.btn} type="button" onClick={() => void view(skill)}>{t(detail?.id === skill.id ? 'hide' : 'details')}</button>
          <button className={css.btnDanger} type="button" disabled={op.busy || !capabilities.trash} onClick={() => {
            if (capabilities.trash && window.confirm(t('trashConfirm'))) void op.run(async () => { await api.trashSkill(cwd, skill); setDetail(null); await refresh() })
          }}>{t('trash')}</button>
        </div>
        {detail?.id === skill.id ? <div className={css.detail}>
          {detail.error ? <ErrorMessage message={detail.error} t={t} /> : detail.value ? <>
            <div className={css.note}>{t('when')}: {detail.value.whenToUse}</div><pre className={css.pre}>{detail.value.content}</pre>
          </> : t('loading')}
        </div> : null}
      </Fragment>})}
    </section>
    <section className={css.section}>
      <h3 className={css.h}>{t('importTitle')}</h3><p className={css.note}>{t('importHint')}</p>
      <div className={css.inline}>
        <input className={css.inputGrow} aria-label={t('directory')} value={dir} disabled={op.busy} placeholder={t('directory')} onChange={e => changeDir(e.target.value)} />
        <button className={css.btn} type="button" disabled={op.busy} onClick={() => void op.run(async () => { const path = await pickDirectory(); if (path) changeDir(path) })}>{t('chooseDirectory')}</button>
        <button className={css.btn} type="button" disabled={op.busy} onClick={() => void op.run(async () => {
          if (!dir.trim()) throw new Error(t('noDirectory'))
          setScanned(null); setSelected(new Set()); setResults([])
          setScanned(await api.scanSkills(cwd, dir.trim()))
        })}>{t('scan')}</button>
      </div>
      {scanned?.length === 0 ? <p>{t('empty')}</p> : scanned?.map(skill => <label className={css.row} key={skill.id}>
        <input type="checkbox" disabled={op.busy} checked={selected.has(skill.id)} onChange={e => setSelected(previous => {
          const next = new Set(previous); if (e.target.checked) next.add(skill.id); else next.delete(skill.id); return next
        })} /><span className={css.main}><span className={css.name}>{skill.name} · {t(skill.kind)}</span><span className={css.note}> {skill.sourcePath}</span></span>
      </label>)}
      {scanned?.length ? <button className={css.btn} type="button" disabled={op.busy || !selected.size} onClick={() => void op.run(async () => {
        const chosen = scanned.filter(skill => selected.has(skill.id)).map(({ id, revision }) => ({ id, revision }))
        if (!chosen.length) throw new Error(t('selectFirst'))
        setResults(await api.importSkills(cwd, chosen)); setSelected(new Set()); setScanned(null); await refresh()
      })}>{t('importSelected')} ({selected.size})</button> : null}
      {results.length ? <div role="status"><h4 className={css.h}>{t('imported')}</h4>{results.map((result, index) => <div key={index}>
        {result.name}: {t(result.ok ? 'importOk' : 'importFailed')}{result.reason ? ` · ${result.reason}` : ''}
      </div>)}</div> : null}
    </section>
    <section className={css.section}><h3 className={css.h}>{t('trashTitle')}</h3>
      <ErrorMessage message={trash.error} t={t} />
      {trash.loading ? <p>{t('loading')}</p> : !trash.value?.length ? <p>{t('empty')}</p> : trash.value.map(item => <div className={css.row} key={item.id}>
        <div className={css.main}><div className={css.name}>{item.name}</div><div className={css.note}>{item.originalPath} · {item.deletedAt}</div></div>
        <button type="button" className={css.btn} disabled={op.busy} onClick={() => void op.run(async () => { await api.restoreTrash(cwd, item.id); await refresh() })}>{t('restore')}</button>
      </div>)}
    </section>
  </div>
}

const statusKeys: Record<McpServerSummary['status'], SkillsMcpKey> = {
  loading: 'loadingStatus', loaded: 'loaded', failed: 'failed', stopped: 'stopped', external: 'external',
}
function McpPanel({ t }: { t: Translate }) {
  const list = useResource<McpList>(useCallback(() => api.listMcp(), []))
  const op = useOperation()
  const [form, setForm] = useState<McpForm>(emptyForm)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<'' | 'saved' | 'testOk'>('')
  const patch = (change: Partial<McpForm>) => { setForm(previous => ({ ...previous, ...change })); setNote('') }
  const edit = (server: McpServerSummary) => {
    if (!mcpCapabilities(server).edit || !list.value) return
    setForm({ id: server.id, revision: list.value.revision, name: server.name, transport: server.transport, enabled: server.enabled,
      command: server.command || '', args: (server.args || []).join('\n'), cwd: server.cwd || '', url: server.url || '',
      envRefs: refsText(server.envRefs), headerRefs: refsText(server.headerRefs) })
    setNote(''); op.setMessage('')
  }
  return <div className={css.panel}>
    <section className={css.section}>
      <div className={css.inline}><h3 className={css.hGrow}>{t('mcp')}</h3><button className={css.btn} type="button" disabled={op.busy || list.loading} onClick={() => void list.reload()}>{t('refresh')}</button></div>
      <p className={css.note}>{t('statusHint')}</p>
      <input className={css.input} aria-label={t('search')} placeholder={t('search')} value={query} onChange={e => setQuery(e.target.value)} />
      <ErrorMessage message={list.error || op.message} t={t} />
      {list.value?.legacyAvailable ? <p className={css.note}>{t('legacy')}</p> : null}
      {list.loading ? <p role="status">{t('loading')}</p> : !list.value?.servers.length ? <p>{t('empty')}</p> : list.value.servers.filter(server => server.name.toLowerCase().includes(query.trim().toLowerCase())).map(server => {
        const capabilities = mcpCapabilities(server)
        return <div className={css.row} key={server.id}>
          <div className={css.main}><div className={css.name}>{server.name}</div>
            <div className={css.note}>{t(server.source === 'native' ? 'native' : 'managed')}{server.source === 'native' && capabilities.toggle ? ` · ${t('switchSupported')}` : ''} · {t(statusKeys[server.status])} · {t('tools')}: {server.toolCount}</div>
            <div className={css.desc}>{server.transport} · {server.transport === 'stdio' ? server.command : server.url}</div>
            {server.error ? <ErrorMessage message={server.error} t={t} /> : null}
          </div>
          <label className={css.switch}><input type="checkbox" role="switch" aria-checked={server.enabled} aria-label={`${t('enabled')} · ${server.name}`} checked={server.enabled} disabled={!capabilities.toggle || op.busy || list.loading} onChange={() => {
            if (!capabilities.toggle || !list.value || (!server.enabled && !window.confirm(t('enableConfirm')))) return
            const revision = list.value.revision
            void op.run(async () => { await api.setMcpEnabled(server.id, !server.enabled, revision); await list.reload() })
          }} /><span>{t(server.enabled ? 'enabled' : 'disabled')}</span></label>
          {capabilities.remove ? <><button className={css.btn} type="button" disabled={!capabilities.edit || op.busy || list.loading} onClick={() => edit(server)}>{t('edit')}</button>
            <button className={css.btnDanger} type="button" disabled={op.busy || list.loading} onClick={() => {
              if (!capabilities.remove || !list.value || !window.confirm(t('removeConfirm'))) return
              const revision = list.value.revision
              void op.run(async () => { await api.deleteMcp(server.id, revision); if (form.id === server.id) setForm(emptyForm()); await list.reload() })
            }}>{t('remove')}</button></> : null}
        </div>
      })}
    </section>
    <section className={css.section}>
      <h3 className={css.h}>{t('formTitle')}</h3>
      <p className={css.note}>{t('referencesHint')}</p><p className={css.note}>{t('commandHint')}</p>
      <fieldset className={css.form} disabled={op.busy}>
        <Field label={t('name')}><input className={css.input} maxLength={32} value={form.name} onChange={e => patch({ name: e.target.value })} /></Field>
        <Field label={t('transport')}><select className={css.input} value={form.transport} onChange={e => patch({ transport: e.target.value as McpForm['transport'] })}>
          <option value="stdio">stdio</option><option value="streamable-http">streamable-http</option></select></Field>
        {form.transport === 'stdio' ? <>
          <Field label={t('command')}><input className={css.input} value={form.command} onChange={e => patch({ command: e.target.value })} /></Field>
          <Field label={t('args')}><textarea className={css.input} rows={3} value={form.args} onChange={e => patch({ args: e.target.value })} /></Field>
          <Field label={t('cwd')}><input className={css.input} value={form.cwd} onChange={e => patch({ cwd: e.target.value })} /></Field>
          <Field label={t('envRefs')}><textarea className={css.input} rows={3} autoComplete="off" spellCheck={false} value={form.envRefs} onChange={e => patch({ envRefs: e.target.value })} /></Field>
        </> : <>
          <Field label={t('url')}><input className={css.input} value={form.url} onChange={e => patch({ url: e.target.value })} /></Field>
          <Field label={t('headerRefs')}><textarea className={css.input} rows={3} autoComplete="off" spellCheck={false} value={form.headerRefs} onChange={e => patch({ headerRefs: e.target.value })} /></Field>
        </>}
        <label className={css.switch}><input type="checkbox" checked={form.enabled} onChange={e => patch({ enabled: e.target.checked })} />{t('enableOnSave')}</label>
        <div className={css.inline}>
          <button className={css.btnPrimary} type="button" disabled={!list.value || list.loading} onClick={() => void op.run(async () => {
            const server = buildMcpServer(form, t)
            if (server.enabled && !window.confirm(t('enableConfirm'))) return
            const revision = form.revision ?? list.value?.revision
            if (revision === undefined) return
            await api.saveMcp(server, revision); setForm(emptyForm()); setNote('saved'); await list.reload()
          })}>{t(op.busy ? 'saving' : 'save')}</button>
          <button className={css.btn} type="button" onClick={() => void op.run(async () => {
            const server = buildMcpServer(form, t)
            if (!window.confirm(t('testConfirm'))) return
            const result = await api.testMcp(server)
            if (!result.ok) throw new Error(`${t('testFailed')} ${result.error || ''}`)
            setNote('testOk')
          })}>{t(op.busy ? 'testing' : 'test')}</button>
          <button className={css.btn} type="button" onClick={() => { setForm(emptyForm()); setNote(''); op.setMessage('') }}>{t('reset')}</button>
        </div>
      </fieldset>
      {note ? <p className={css.note} role="status">{t(note)}</p> : null}
    </section>
  </div>
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={css.fieldLabel}><span className={css.fieldName}>{label}</span>{children}</label>
}
function ErrorMessage({ message, t }: { message: string; t: Translate }) {
  return message ? <p className={css.error} role="alert">{t('error')}: {message}</p> : null
}
