/**
 * 零依赖测试入口。
 *
 * 不引入 vitest/jest——只为几个纯函数单测装一个测试框架不划算，
 * 而且离线环境下 npm install 经常失败。这里直接用 vite 自带的 esbuild
 * 把 tests/*.test.ts 打成一个 ESM 文件再 import 运行。
 *
 * 用法：npm run test
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, '.tmp', 'tests.mjs')

fs.mkdirSync(path.dirname(OUT), { recursive: true })

await build({
  entryPoints: [path.join(ROOT, 'tests', 'all.test.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: OUT,
  logLevel: 'warning',
  // 测试要能 import 到 src 里的 JSON（words.json / sentences.json）
  loader: { '.json': 'json' },
})

const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now())
const { results } = mod.default || mod

let fail = 0
for (const r of results) {
  if (r.ok) {
    console.log('  ok   ' + r.name)
  } else {
    fail++
    console.log('  FAIL ' + r.name)
    for (const m of r.msgs) console.log('       ' + m)
  }
}
console.log('')
console.log(`${results.length - fail}/${results.length} passed`)
process.exit(fail ? 1 : 0)
