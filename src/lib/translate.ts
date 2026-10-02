/**
 * 翻译关的纯逻辑（可在 Node 里单测）。
 *
 * 英译汉：1 个正确中文 + 5 个干扰项（v3.3 从 3 个加到 5 个），洗牌后作为选项。
 * 干扰项优先取同一张卷里的词（孩子正在学的，区分度最有价值），
 * 不够 5 个时从 extraPool（全册词库）兜底，仍不够就 fewer，绝不掺重复释义。
 */
import { seededShuffle } from './shuffle'

export interface CnOption {
  cn: string
  correct: boolean
}

export function buildCnOptions(
  items: { word: string; cn: string }[],
  word: string,
  seedStr: string,
  extraPool: { word: string; cn: string }[] = [],
): CnOption[] {
  const cur = items.find(i => i.word === word)
  if (!cur || !cur.cn) return []
  const curCn = cur.cn
  const same = items.filter(i => i.word !== word && i.cn && i.cn !== curCn)
  const seen = new Set(same.map(i => i.cn))
  // 全册兜底：排除卷内已有、与正确答案同义的，剩下的进池（带去重副作用）
  const extra = extraPool.filter(i => {
    if (!i.cn || i.cn === curCn || seen.has(i.cn)) return false
    seen.add(i.cn)
    return true
  })
  const pool = [...same, ...extra]
  const distractors = seededShuffle(pool, seedStr).slice(0, 5)
  const opts: CnOption[] = [
    { cn: curCn, correct: true },
    ...distractors.map(d => ({ cn: d.cn, correct: false })),
  ]
  // 选项顺序用另一个盐，保证与干扰项抽取独立
  return seededShuffle(opts, seedStr + '#opts')
}
