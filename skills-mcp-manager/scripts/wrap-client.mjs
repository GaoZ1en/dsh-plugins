/** Wrap esbuild's CJS and optional extracted CSS in the Harness module loader.
 * The factory is side-effect free: CSS is installed only during apply and is
 * removed by that context's effect disposer. Inputs are retained for inspection.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const cjsPath = new URL('../lib/client.cjs', import.meta.url)
const cssPath = new URL('../lib/client.css', import.meta.url)
const outPath = new URL('../lib/client.js', import.meta.url)
const body = readFileSync(cjsPath, 'utf8')
let css = ''
try { css = readFileSync(cssPath, 'utf8') }
catch (error) { if (error.code !== 'ENOENT') throw error }

const wrapped = [
  'window.__ModuleLoader__.load({',
  '  id: ' + JSON.stringify(pkg.name) + ',',
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  body,
  '    var original = module.exports;',
  '    return Object.assign({}, original, {',
  '      apply: function(ctx) {',
  ...(css ? [
    '        ctx.effect(function() {',
    '          var style = document.createElement("style");',
    '          style.dataset.pluginCss = ' + JSON.stringify(pkg.name) + ';',
    '          style.textContent = ' + JSON.stringify(css) + ';',
    '          document.head.appendChild(style);',
    '          return function() { style.remove(); };',
    '        });',
  ] : []),
  '        return original.apply(ctx);',
  '      }',
  '    });',
  '  }',
  '});',
  '',
].join('\n')
writeFileSync(outPath, wrapped, 'utf8')
console.log('[wrap-client] wrote lib/client.js (' + Buffer.byteLength(wrapped) + ' bytes)')
