/**
 * 灌库执行体（由 scripts/backfill-wordstate.mjs 用 esbuild 打包后运行）。
 * 输入：wrangler d1 execute --json 的输出（含 progress_snapshots.data）
 * 输出：可以直接喂给 wrangler d1 execute --file 的 SQL
 */
import fs from 'node:fs'
import { migrateFromLegacy, assertMigration } from '../src/lib/memory'
import type { Progress } from '../src/types'

export default function run(inPath: string, outPath: string) {
  // wrangler 有时会在 stdout 前面打一行 proxy 提示，直接 JSON.parse 会炸
  const txt = fs.readFileSync(inPath, 'utf8')
  const start = txt.indexOf('[')
  if (start < 0) throw new Error('输入里没有 JSON 数组')
  const raw = JSON.parse(txt.slice(start))
  const rows: { student_id: string; data: string }[] = []
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk)
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      if (typeof o.student_id === 'string' && typeof o.data === 'string') rows.push(o as never)
      else Object.values(o).forEach(walk)
    }
  }
  walk(raw)
  if (!rows.length) throw new Error('没找到 progress_snapshots 行，检查 wrangler 输出')

  const now = Date.now()
  // D1 不接受 BEGIN TRANSACTION（要走 Durable Object 的 transaction API）。
  // 这里每条都是幂等 upsert，重复跑安全，所以不包事务。
  const lines: string[] = []
  const report: Record<string, number> = {}

  for (const r of rows) {
    const p = JSON.parse(r.data) as Progress
    const state = migrateFromLegacy(p)
    const chk = assertMigration(p, state)
    if (!chk.ok) throw new Error(`${r.student_id} 迁移断言失败：${chk.problems.slice(0, 5).join('；')}`)

    for (const [word, s] of Object.entries(state)) {
      const esc = (v: string) => v.replace(/'/g, "''")
      lines.push(
        `INSERT INTO word_state (student_id, word, s, due_day, lapses, streak, master, ok_n, all_n, updated_at)` +
        ` VALUES ('${esc(r.student_id)}','${esc(word)}',${s.S},'${s.due}',${s.lapses},${s.streak},${s.master},${s.ok},${s.n},${now})` +
        ` ON CONFLICT(student_id, word) DO UPDATE SET s=excluded.s, due_day=excluded.due_day,` +
        ` lapses=excluded.lapses, streak=excluded.streak, master=excluded.master,` +
        ` ok_n=excluded.ok_n, all_n=excluded.all_n, updated_at=excluded.updated_at;`
      )
    }
    report[r.student_id] = Object.keys(state).length
  }

  fs.writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(JSON.stringify({ students: report, sql: outPath, bytes: fs.statSync(outPath).size }, null, 1))
}
