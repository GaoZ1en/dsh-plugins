import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await build({ entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', sourcemap: false })
await build({ entryPoints: ['src/client/index.ts'], outfile: 'lib/client.cjs', bundle: true, external: ['react', 'react/jsx-runtime', 'react-dom'], platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic', sourcemap: false, minify: false })
