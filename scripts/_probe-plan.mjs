/**
 * 临时诊断脚本：用 p1 的真实参数跑一遍新计划，看排出来多少题、多少分钟。
 * 用法：node scripts/_probe-plan.mjs
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, '.tmp', 'probe.mjs')
fs.mkdirSync(path.dirname(OUT), { recursive: true })

await build({
  entryPoints: [path.join(ROOT, 'scripts', '_probe-src.ts')],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
})

const m = await import(pathToFileURL(OUT).href)
m.run()
