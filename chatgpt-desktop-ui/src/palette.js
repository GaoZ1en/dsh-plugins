/** Surface colors verified against DSH 0.2.1-rc.2.
 * Official typography, state foregrounds and diff colors remain unchanged.
 */
export const PALETTE_SOURCE = '@koishi/dsh-chatgpt-message-style';
export const COLOR_OVERRIDES = Object.freeze({
  '--dsw-alias-bg-base': Object.freeze({ light: '#f8f7fc', dark: '#202030' }),
  '--dsw-alias-bg-layer-1': Object.freeze({ light: '#ffffff', dark: '#272739' }),
  '--dsw-alias-bg-layer-2': Object.freeze({ light: '#eeecf5', dark: '#2d2d40' }),
  '--dsw-alias-bg-overlay': Object.freeze({ light: '#ffffff', dark: '#303044' }),
  '--dsw-alias-border-l1': Object.freeze({ light: '#dfdce9', dark: '#363648' }),
  '--dsw-alias-border-l2': Object.freeze({ light: '#c9c4d8', dark: '#49485b' }),
  '--dsw-alias-brand-primary': Object.freeze({ light: '#71648e', dark: '#bab1d7' }),
  '--dsw-alias-label-primary': Object.freeze({ light: '#343240', dark: '#dedce9' }),
  '--dsw-alias-label-secondary': Object.freeze({ light: '#6c667a', dark: '#aaa7bc' }),
  '--dsw-specific-sidebar-fill': Object.freeze({ light: '#eeedf5', dark: '#252635' }),
  '--dsw-specific-input-major': Object.freeze({ light: '#f0edf7', dark: '#343449' }),
  '--dsw-specific-menu': Object.freeze({ light: '#ffffff', dark: '#2d2d40' }),

  // File/plan cards consume these shared neutrals directly. Keep static
  // brightness independent of the active scheme, including text consumers.
  '--dsw-static-neutral-50': Object.freeze({ light: '#f7f6fb', dark: '#f7f6fb' }),
  '--dsw-static-neutral-100': Object.freeze({ light: '#efedf6', dark: '#efedf6' }),
  '--dsw-static-neutral-850': Object.freeze({ light: '#2a2a3d', dark: '#2a2a3d' }),
  '--dsw-static-neutral-800': Object.freeze({ light: '#343449', dark: '#343449' }),

  // Plan/approval strips retain the host warning foreground and a warm tint.
  '--dsw-alias-state-warn-tertiary': Object.freeze({
    light: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2) 96%, var(--dsw-alias-state-warn-primary))',
    dark: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2) 96%, var(--dsw-alias-state-warn-primary))'
  }),
  '--dsw-alias-markdown-code-block': Object.freeze({ light: '#f0edf7', dark: '#252536' }),
  '--dsw-alias-bg-module-platform': Object.freeze({ light: '#f0edf7', dark: '#2b2b3f' }),
  '--dsw-alias-button-floating-fill': Object.freeze({ light: '#ffffff', dark: '#303045' }),
  '--dsw-alias-button-floating-hover': Object.freeze({ light: '#eeecf5', dark: '#3a394f' }),
  '--dsw-alias-interactive-bg-hover': Object.freeze({ light: '#efedf6', dark: '#2e2e43' }),
  '--dsw-alias-interactive-bg-hover-solid': Object.freeze({ light: '#eeecf5', dark: '#39384e' }),
  '--dsw-alias-border-l2-darkmode-thin': Object.freeze({ light: '#dcd8e6', dark: '#45445a' }),
  '--dsw-alias-border-l3': Object.freeze({ light: '#b9b2ca', dark: '#57556d' }),
  '--dsw-menu-surface-fill': Object.freeze({ light: 'rgba(255,255,255,0.94)', dark: 'rgba(45,45,64,0.45)' }),
  '--dsw-alias-menu-group-header-fill': Object.freeze({ light: 'rgba(255,255,255,0.94)', dark: 'rgba(45,45,64,0.94)' })
});

/** The caller owns this exact layer's disposer; no durable preference writes. */
export function installPalette(theme) {
  return theme.overrideTokens(PALETTE_SOURCE, COLOR_OVERRIDES);
}
