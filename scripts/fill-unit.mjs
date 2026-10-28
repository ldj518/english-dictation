/**
 * 给 words.json 里 154 个 unit 为空的词补归属。
 *
 * 依据（不是编造）：每首听写音频（dayNN）就是当天的词表，7 个单元按
 * 「5–6 个 day 一个单元」排。先用已经有 unit 的词反推每个 day 的**多数单元**，
 * 再用它给同一天里漏标的词补上。跨单元的少数派（每天 1–2 个）保留原值不动。
 *
 * 跑法：node scripts/fill-unit.mjs
 */
import fs from 'node:fs'

const P = 'src/data/words.json'
const words = JSON.parse(fs.readFileSync(P, 'utf8'))

const tally = new Map()
for (const w of words) {
  if (!w.unit) continue
  if (!tally.has(w.firstTask)) tally.set(w.firstTask, new Map())
  const m = tally.get(w.firstTask)
  m.set(w.unit, (m.get(w.unit) || 0) + 1)
}

const dayUnit = new Map()
for (const [day, m] of tally) {
  const best = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  dayUnit.set(day, best[0])
}

let filled = 0
const missing = []
for (const w of words) {
  if (w.unit) continue
  const u = dayUnit.get(w.firstTask)
  if (!u) { missing.push(w.word); continue }
  w.unit = u
  filled++
}

const cnt = {}
for (const w of words) cnt[w.unit || 'EMPTY'] = (cnt[w.unit || 'EMPTY'] || 0) + 1

fs.writeFileSync(P, JSON.stringify(words, null, 1) + '\n')
console.log(JSON.stringify({ filled, missing, total: words.length, cnt }, null, 1))
