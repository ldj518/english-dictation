/**
 * 翻译关的纯逻辑（可在 Node 里单测）。
 *
 * 英译汉：1 个正确中文 + 3 个同卷干扰项，洗牌后作为选项。
 * 干扰项优先取同一张卷里的词（孩子正在学的，区分度最有价值），
 * 不够 3 个时允许 fewer，绝不掺重复释义。
 */
import { seededShuffle } from './shuffle'

export interface CnOption {
  cn: string
  correct: boolean
}

export function buildCnOptions(
  items: { word: string; cn: string }[],
  word: string,
  seedStr: string
): CnOption[] {
  const cur = items.find(i => i.word === word)
  if (!cur || !cur.cn) return []
  const pool = items.filter(i => i.word !== word && i.cn && i.cn !== cur.cn)
  const distractors = seededShuffle(pool, seedStr).slice(0, 3)
  const opts: CnOption[] = [
    { cn: cur.cn, correct: true },
    ...distractors.map(d => ({ cn: d.cn, correct: false })),
  ]
  // 选项顺序用另一个盐，保证与干扰项抽取独立
  return seededShuffle(opts, seedStr + '#opts')
}
