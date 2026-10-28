/**
 * 线上历史灌库：progress_snapshots 的 JSON → word_state 行。
 *
 * 为什么不在 SQL 里手写映射：迁移规则只许有一个实现。这里直接 import
 * memory.ts 的 migrateFromLegacy，跑出来的结果和手机端首次打开时算的完全一致，
 * 不会出现「云端 190 行、手机算 193 行」这种对不上的局面。
 *
 * 用法：node scripts/backfill-wordstate.mjs <快照json> <输出sql>
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, '.tmp', 'backfill.mjs')
fs.mkdirSync(path.dirname(OUT), { recursive: true })

await build({
  entryPoints: [path.join(ROOT, 'scripts', 'backfill-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: OUT,
  logLevel: 'warning',
  loader: { '.json': 'json' },
})

const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now())
mod.default(process.argv[2], process.argv[3])
