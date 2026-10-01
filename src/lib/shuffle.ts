/**
 * 可复现的洗牌（种子随机）。
 *
 * 设计目标：防止孩子找到出题规律。
 * - 同一天、同一人、同一任务 → 顺序固定（可复现，便于「上次做到第几题」续做）
 * - 换一天 → 顺序变化
 * - 换一个人 → 顺序变化
 * - 用户手动「重新洗牌」→ 用新种子立刻换顺序
 *
 * 用 mulberry32（32 位可播种 PRNG），轻量、无依赖、分布均匀。
 */

/** 把任意字符串散列成 32 位整数种子（FNV-1a） */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32：返回 [0,1) 的随机数发生器 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 种子洗牌：返回打乱后的新数组（不修改入参）。
 * @param arr 原数组
 * @param seedStr 种子字符串（如 `${date}:${profileId}:${trackId}`）
 */
export function seededShuffle<T>(arr: readonly T[], seedStr: string): T[] {
  const out = arr.slice()
  const rnd = mulberry32(hashSeed(seedStr))
  // Fisher-Yates
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * 为一个任务生成稳定的洗牌种子。
 * @param date yyyy-mm-dd
 * @param profileId 孩子身份
 * @param trackId 任务 id
 * @param salt 额外扰动（手动重新洗牌时用时间戳，可让当天顺序变化）
 */
export function makeSeed(date: string, profileId: string, trackId: string, salt = ''): string {
  return `${date}|${profileId}|${trackId}${salt ? '|' + salt : ''}`
}

/** 生成一个短随机盐（用于「重新洗牌」） */
export function newSalt(): string {
  return Math.random().toString(36).slice(2, 8)
}
