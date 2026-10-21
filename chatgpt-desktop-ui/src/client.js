export function createClient(React, model, appearance) {
  const h = React.createElement;
  const NS = 'koishi-chatgpt-message-style';
  const dictionaries = {
    en: { copy: 'Copy message', copied: 'Copied', copyFailed: 'Copy failed. Select the message text and copy manually.', copying: 'Copying…', unavailable: 'This message could not be displayed.' },
    zh: { copy: '复制消息', copied: '已复制', copyFailed: '复制失败，请选中消息正文手动复制。', copying: '正在复制…', unavailable: '此消息暂时无法显示。' }
  };
  const css = `
.koishi-cg-message{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:0;width:100%;padding-block:6px;color:var(--dsw-alias-label-primary)}
.koishi-cg-bubble{box-sizing:border-box;max-inline-size:min(100%,max(82%,22rem));min-width:0;padding:12px 18px;border-radius:24px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
.koishi-cg-support{max-inline-size:100%;min-width:0;align-self:stretch}
.koishi-cg-meta{max-inline-size:100%;min-width:0;align-self:flex-end;font:inherit;font-size:var(--dsh-content-font-size-secondary,12px);line-height:1.5;color:var(--dsw-alias-label-secondary)}
.koishi-cg-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0}
.koishi-cg-time{min-width:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.koishi-cg-copy{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;inline-size:max(30px,1.8em);block-size:max(30px,1.8em);flex:none;padding:6px;border:0;border-radius:8px;font:inherit;color:inherit;background:transparent;cursor:pointer}
.koishi-cg-copy svg{display:block;inline-size:1.15em;block-size:1.15em}
.koishi-cg-copy:hover{background:var(--dsw-alias-bg-layer-1)}
.koishi-cg-copy:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.koishi-cg-copy:disabled{cursor:progress}
.koishi-cg-error{margin-block-start:4px;max-inline-size:100%;text-align:end;overflow-wrap:anywhere;color:var(--dsw-alias-state-error-primary)}
.koishi-cg-status{position:absolute;inline-size:1px;block-size:1px;padding:0;border:0;clip-path:inset(50%);overflow:hidden;white-space:nowrap}
.koishi-cg-reasoning{box-sizing:border-box;min-width:0;max-inline-size:100%;padding-inline-start:12px;border-inline-start:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
@media(pointer:coarse){.koishi-cg-copy{min-inline-size:44px;min-block-size:44px}}
`;

  function MessageActions({ text, time, t }) {
    const [state, setState] = React.useState('idle');
    const epoch = React.useRef(0);
    const pending = React.useRef(false);
    React.useEffect(() => {
      epoch.current += 1;
      pending.current = false;
      setState('idle');
      return () => { epoch.current += 1; pending.current = false; };
    }, [text]);
    React.useEffect(() => {
      if (state !== 'copied') return undefined;
      const timer = setTimeout(() => setState('idle'), 1500);
      return () => clearTimeout(timer);
    }, [state]);
    const label = state === 'copied' ? t('copied') : state === 'pending' ? t('copying') : t('copy');
    const copy = async () => {
      if (pending.current || text === '') return;
      const current = epoch.current;
      pending.current = true;
      setState('pending');
      const ok = await model.copyOriginal(text, globalThis.navigator?.clipboard);
      if (current !== epoch.current) return;
      pending.current = false;
      setState(ok ? 'copied' : 'failed');
    };
    return h('div', { className: 'koishi-cg-meta' },
      h('div', { className: 'koishi-cg-actions' },
        time ? h('time', { className: 'koishi-cg-time', dateTime: time.iso, title: time.title, 'aria-label': time.title }, time.label) : null,
        text !== '' ? h('button', { className: 'koishi-cg-copy', type: 'button', onClick: copy, disabled: state === 'pending', 'aria-busy': state === 'pending', 'aria-label': label, title: label },
          h('svg', { viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
            state === 'copied' ? h('path', { d: 'm5 12 4 4L19 6' }) : h(React.Fragment, null, h('rect', { x: 8, y: 8, width: 12, height: 12, rx: 2 }), h('path', { d: 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' })))) : null
      ),
      h('span', { className: 'koishi-cg-status', role: 'status', 'aria-live': 'polite' }, state === 'copied' ? t('copied') : ''),
      state === 'failed' ? h('div', { className: 'koishi-cg-error', role: 'alert' }, t('copyFailed')) : null
    );
  }

  function UserMessage({ node, loadImage, renderFactorySlot, useMessageLocale, t }) {
    const prepared = React.useMemo(() => {
      try { return model.prepareUserMessage(node.data); } catch { return null; }
    }, [node.data]);
    const locale = useMessageLocale((snapshot) => snapshot.active);
    const time = model.messageTime(node.data?.time, locale);
    if (prepared === null) return h('div', { className: 'koishi-cg-message', role: 'status' }, t('unavailable'));
    const content = (part) => renderFactorySlot('conversation.chat.user.content', { content: part, loadImage, facts: prepared.facts, interactive: true });
    return h('div', { className: 'koishi-cg-message' },
      prepared.attachments.length > 0 ? h('div', { className: 'koishi-cg-support' }, content({ text: '', attachments: prepared.attachments, extraBlocks: [] })) : null,
      prepared.text !== '' ? h('div', { className: 'koishi-cg-bubble' }, renderFactorySlot('conversation.user.text', { text: prepared.text, facts: prepared.facts, interactive: true, ellipsis: false })) : null,
      prepared.extraBlocks.length > 0 || prepared.referenceLabels.length > 0 ? h('div', { className: 'koishi-cg-support' }, content({ text: '', attachments: [], extraBlocks: prepared.extraBlocks, referenceLabels: prepared.referenceLabels })) : null,
      h(MessageActions, { text: prepared.text, time, t })
    );
  }

  function ReasoningBody({ text, running, renderFactorySlot }) {
    return h('div', { className: 'koishi-cg-reasoning' }, renderFactorySlot('conversation.chat.reasoning.content', { text, running }));
  }

  return {
    inject: ['slots', 'locale', 'theme'],
    apply(ctx) {
      ctx.effect(() => appearance.installPalette(ctx.theme));
      ctx.effect(() => ctx.locale.register(NS, dictionaries));
      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = '@koishi/dsh-chatgpt-message-style';
        style.textContent = css;
        document.head.appendChild(style);
        return () => style.remove();
      });
      ctx.slots.inject('conversation.chat.node', function* () {
        for (const key of ['user', 'steering']) yield ctx.slots.register({
          name: 'conversation.chat.node', key, priority: -31, locale: NS,
          inject: () => ({ hooks: { messageLocale: ctx.locale } })
        }, UserMessage);
      });
      ctx.slots.inject('conversation.chat.reasoning.body', () => ctx.slots.register({ name: 'conversation.chat.reasoning.body', priority: 29 }, ReasoningBody));
    }
  };
}
