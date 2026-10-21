import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PALETTE_SOURCE, COLOR_OVERRIDES, installPalette } from '../src/palette.js';

const root = new URL('../', import.meta.url);
const known = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay', '--dsw-alias-border-l1', '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary', '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-specific-sidebar-fill', '--dsw-specific-input-major', '--dsw-specific-menu',
  '--dsw-static-neutral-50', '--dsw-static-neutral-100', '--dsw-static-neutral-850', '--dsw-static-neutral-800',
  '--dsw-alias-state-warn-tertiary', '--dsw-alias-markdown-code-block', '--dsw-alias-bg-module-platform',
  '--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover',
  '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-border-l3',
  '--dsw-menu-surface-fill', '--dsw-alias-menu-group-header-fill'
];
const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16));
const mix = (a, b, weight) => a.map((x, i) => x * (1 - weight) + b[i] * weight);
const luminance = color => {
  const values = (Array.isArray(color) ? color : rgb(color)).map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
};
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Contracts confirmed in the installed 0.2.1-rc.2 component styles/README.
const consumers = {
  planAndApproval: ['--dsw-specific-input-major', '--dsw-alias-state-warn-tertiary'],
  fileCards: ['--dsw-static-neutral-50', '--dsw-static-neutral-100', '--dsw-static-neutral-850', '--dsw-static-neutral-800'],
  toolOutput: ['--dsw-alias-markdown-code-block', '--dsw-alias-border-l1', '--dsw-alias-border-l2'],
  questionsAndThumbnails: ['--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-solid'],
  floatingButtons: ['--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover'],
  menus: ['--dsw-menu-surface-fill', '--dsw-alias-menu-group-header-fill', '--dsw-alias-border-l3'],
  settings: ['--dsw-alias-bg-module-platform', '--dsw-alias-interactive-bg-hover']
};

test('palette uses verified color tokens with explicit light/dark values', () => {
  assert.deepEqual(Object.keys(COLOR_OVERRIDES), known);
  for (const [key, modes] of Object.entries(COLOR_OVERRIDES)) {
    assert.deepEqual(Object.keys(modes), ['light', 'dark']);
    for (const value of Object.values(modes)) {
      if (key === '--dsw-alias-state-warn-tertiary') assert.match(value, /^color-mix\(in srgb, var\(--dsw-alias-bg-layer-2\) 96%, var\(--dsw-alias-state-warn-primary\)\)$/);
      else if (key === '--dsw-menu-surface-fill' || key === '--dsw-alias-menu-group-header-fill') assert.match(value, /^rgba\(\d+,\d+,\d+,0\.\d+\)$/);
      else assert.match(value, /^#[0-9a-f]{6}$/);
    }
  }
  assert.equal(COLOR_OVERRIDES['--dsw-alias-bg-base'].dark, '#202030');
});
test('primary and secondary text remain readable on the audited opaque surfaces', () => {
  const surfaces = [
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
    '--dsw-specific-sidebar-fill', '--dsw-specific-input-major', '--dsw-specific-menu',
    '--dsw-alias-markdown-code-block', '--dsw-alias-bg-module-platform',
    '--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover',
    '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-solid'
  ];
  for (const mode of ['light', 'dark']) {
    const cardSurfaces = mode === 'light' ? ['--dsw-static-neutral-50', '--dsw-static-neutral-100'] : ['--dsw-static-neutral-850', '--dsw-static-neutral-800'];
    for (const token of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary']) {
      for (const surface of [...surfaces, ...cardSurfaces]) {
        const ratio = contrast(COLOR_OVERRIDES[token][mode], COLOR_OVERRIDES[surface][mode]);
        assert.ok(ratio >= 4.5, `${mode} ${token} on ${surface}: ${ratio}`);
      }
    }
  }
});
test('composer and task surfaces have explicit purple backgrounds', () => {
  assert.deepEqual(COLOR_OVERRIDES['--dsw-specific-input-major'], { light: '#f0edf7', dark: '#343449' });
  assert.deepEqual(COLOR_OVERRIDES['--dsw-specific-menu'], { light: '#ffffff', dark: '#2d2d40' });
});
test('every confirmed consumer has its surface tokens covered', () => {
  for (const [consumer, tokens] of Object.entries(consumers)) {
    for (const token of tokens) assert.ok(Object.hasOwn(COLOR_OVERRIDES, token), `${consumer}: ${token}`);
  }
});
test('warning, error, diff and destructive-action foregrounds are not overridden', () => {
  const protectedTokens = [
    '--dsw-alias-state-warn-primary', '--dsw-alias-state-warn-secondary',
    '--dsw-alias-state-error-primary', '--dsw-alias-state-success-primary',
    '--dsw-alias-state-ongoing-primary', '--dsw-alias-interactive-bg-hover-danger',
    '--dsw-static-neutral-00', '--dsw-static-neutral-1000'
  ];
  for (const token of protectedTokens) assert.equal(Object.hasOwn(COLOR_OVERRIDES, token), false, token);
  assert.equal(Object.keys(COLOR_OVERRIDES).some(key => /font|file-diff|static-(red|green|amber|blue|deepseek)/.test(key)), false);
  const warning = COLOR_OVERRIDES['--dsw-alias-state-warn-tertiary'];
  assert.equal(warning.light, warning.dark);
  assert.ok(warning.dark.includes('var(--dsw-alias-state-warn-primary)'));
});
test('shared neutral ramps retain brightness and never flip between modes', () => {
  const originals = { '50': '#fafafa', '100': '#f5f5f5', '800': '#292929', '850': '#212123' };
  const values = [];
  for (const [level, original] of Object.entries(originals)) {
    const modes = COLOR_OVERRIDES[`--dsw-static-neutral-${level}`];
    assert.equal(modes.light, modes.dark);
    assert.ok(Math.abs(luminance(modes.light) - luminance(original)) < 0.075, level);
    values.push(luminance(modes.light));
  }
  for (let i = 1; i < values.length; i++) assert.ok(values[i - 1] > values[i]);
});
test('menu materials preserve translucent fills without changing backdrop behavior', () => {
  assert.equal(COLOR_OVERRIDES['--dsw-menu-surface-fill'].dark, 'rgba(45,45,64,0.45)');
  assert.equal(COLOR_OVERRIDES['--dsw-alias-menu-group-header-fill'].dark, 'rgba(45,45,64,0.94)');
  assert.equal(Object.hasOwn(COLOR_OVERRIDES, '--dsw-menu-backdrop-filter'), false);
  for (const mode of ['light', 'dark']) {
    for (const key of ['--dsw-menu-surface-fill', '--dsw-alias-menu-group-header-fill']) {
      const parts = COLOR_OVERRIDES[key][mode].match(/^rgba\((\d+),(\d+),(\d+),(0\.\d+)\)$/).slice(1).map(Number);
      const surface = mix(rgb(COLOR_OVERRIDES['--dsw-alias-bg-base'][mode]), parts.slice(0, 3), parts[3]);
      for (const token of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary']) assert.ok(contrast(COLOR_OVERRIDES[token][mode], surface) >= 4.5);
    }
  }
});
test('palette installation delegates one layer and returns the exact host disposer', () => {
  const calls = [];
  let removed = false;
  const dispose = () => { removed = true; };
  const result = installPalette({ overrideTokens(source, overrides) { calls.push({ source, overrides }); return dispose; } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, PALETTE_SOURCE);
  assert.equal(calls[0].overrides, COLOR_OVERRIDES);
  assert.equal(result, dispose);
  result();
  assert.equal(removed, true);
});
test('typography follows the host and palette installation is context-owned', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8');
  const bubble = source.match(/\.koishi-cg-bubble\{([^}]+)\}/)[1];
  assert.equal(bubble.includes('font-family'), false);
  assert.equal(source.includes('Comic Sans'), false);
  assert.ok(source.includes('ctx.effect(() => appearance.installPalette(ctx.theme))'));
  assert.ok(source.indexOf('appearance.installPalette(ctx.theme)') < source.indexOf("ctx.slots.inject('conversation.chat.node'"));
  const meta = source.match(/\.koishi-cg-meta\{([^}]+)\}/)[1];
  const button = source.match(/\.koishi-cg-copy\{([^}]+)\}/)[1];
  assert.ok(meta.includes('font:inherit'));
  assert.ok(meta.includes('var(--dsh-content-font-size-secondary,12px)'));
  assert.ok(button.includes('font:inherit'));
  assert.equal(source.includes('font:12px/'), false);
  assert.ok(source.includes('priority: -31'));
  assert.ok(source.includes('priority: 29'));
});
