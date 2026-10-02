/**
 * 音节拆分（启发式规则版，v2.8）
 *
 * 用途（防泄题红线）：只在「学习环节 /learn」的卡片上显示拆分色块（如 wea·ther），
 * 帮孩子把长词切成小块记。听写环节绝不调用——音节拆分等于泄露词形。
 *
 * 算法：前缀/长后缀剥离 → 剩余主体 token 化（元音组/辅音簇）→ 状态机切分。
 * 教学近似规则：
 *  - 双写辅音切中间（hap·py, lit·tle）
 *  - 字母组合（th/ch/sh/ph/ck/ng/qu）和辅音簇的末辅音归下一音节（wea·ther, pen·cil）
 *  - 单辅音夹两元音时归后（o·pen, wa·ter, fa·mi·ly）
 * 不追求语言学正确，只求「读起来顺口」；拆不出来就整词返回（绝不硬拆）。
 */

const PREFIXES = ['under', 'over', 'dis', 'pre', 'mis', 'un', 're', 'im', 'in', 'de', 'ex', 'con', 'com', 'sub']
// 只剥「长而明确」的后缀；er/ed/ly/y/s 这类短尾太容易误伤（water/river/other），交给主体规则处理
const SUFFIXES = ['tion', 'sion', 'ment', 'ness', 'less', 'ful', 'able', 'ible', 'ing']
// 元音字母组合（按长度降序匹配）
const VOWEL_GROUPS = ['eau', 'igh', 'oa', 'ee', 'ea', 'oo', 'ou', 'ow', 'oi', 'oy', 'ai', 'ay', 'au', 'aw', 'ei', 'ie', 'eu', 'ew', 'ue', 'ui']
// 辅音字母组合：整体不拆开
const DIGRAPHS = ['th', 'ch', 'sh', 'ph', 'wh', 'gh', 'ck', 'ng', 'qu']

function isVowel(c: string): boolean {
  return c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u'
}

function hasVowel(s: string): boolean {
  return /[aeiouy]/.test(s)
}

/** 剩余主体：token 化后按教学规则合成音节 */
function splitBody(rest: string): string[] {
  if (rest.length <= 3 || !hasVowel(rest)) return rest ? [rest] : []

  // token 化：V = 元音组（含组合），C = 辅音簇（y 非词首视作元音）
  const toks: { v: boolean; s: string }[] = []
  let i = 0
  while (i < rest.length) {
    const grp = VOWEL_GROUPS.find(g => rest.startsWith(g, i))
    if (grp) { toks.push({ v: true, s: grp }); i += grp.length; continue }
    if (isVowel(rest[i]) || (rest[i] === 'y' && i > 0)) {
      let j = i + 1
      while (j < rest.length && (isVowel(rest[j]) || (rest[j] === 'y' && j > 0))) j++
      toks.push({ v: true, s: rest.slice(i, j) }); i = j; continue
    }
    let j = i + 1
    while (j < rest.length && !isVowel(rest[j]) && !(rest[j] === 'y' && j > 0)) j++
    toks.push({ v: false, s: rest.slice(i, j) }); i = j
  }

  // 合成音节
  const syls: string[] = []
  let cur = ''
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]
    if (tok.v) {
      cur += tok.s
      continue
    }
    if (!cur) { cur += tok.s; continue } // 词首辅音
    const next = toks[k + 1]
    if (!next) { cur += tok.s; continue } // 词尾辅音并入当前
    if (!next.v) { cur += tok.s; continue } // 罕见：辅音后还是辅音，并入
    // 当前是「有元音的音节尾 + 辅音簇 + 下一音节元音」——决定切点
    if (tok.s.length === 2 && tok.s[0] === tok.s[1]) {
      cur += tok.s[0]            // 双写：中间切（hap|py）
      syls.push(cur)
      cur = tok.s[1]
    } else if (tok.s.length >= 3 && tok.s[0] === tok.s[1]) {
      cur += tok.s[0]            // 双写+尾簇：同样从双写中间切（lit|tle, mid|dle）
      syls.push(cur)
      cur = tok.s.slice(1)
    } else if (DIGRAPHS.includes(tok.s)) {
      syls.push(cur)             // 字母组合整体归下（wea|ther）
      cur = tok.s
    } else if (tok.s.length >= 2) {
      cur += tok.s.slice(0, -1)  // 辅音簇：末辅音归下（pen|cil, break|fast）
      syls.push(cur)
      cur = tok.s.slice(-1)
    } else {
      syls.push(cur)             // 单辅音归下（o|pen, fa|mi|ly）
      cur = tok.s
    }
  }
  if (cur) syls.push(cur)
  return syls.filter(Boolean)
}

/** 拆一个词：返回音节数组；不值得拆 / 拆不出多段时返回 [原词] */
export function splitSyllables(word: string): string[] {
  // 短语（含空格/连字符/数字等）不拆——拆出来会把空格挤丢，显示反而误导
  if (!/^[a-zA-Z]+$/.test(word)) return [word]
  const w = word.toLowerCase()
  if (w.length < 5) return [word]

  let parts: string[] = []
  let rest = w

  // 1) 前缀（剥完剩下还得是个带元音的完整块）
  for (const p of PREFIXES) {
    if (rest.length > p.length + 2 && rest.startsWith(p) && hasVowel(rest.slice(p.length))) {
      parts.push(p); rest = rest.slice(p.length); break
    }
  }

  // 2) 后缀（同理，剥完主体必须有元音）
  let suf = ''
  for (const sf of SUFFIXES) {
    if (rest.length > sf.length + 2 && rest.endsWith(sf) && hasVowel(rest.slice(0, rest.length - sf.length))) {
      suf = sf; rest = rest.slice(0, rest.length - sf.length); break
    }
  }

  // 3) 主体切分
  const body = splitBody(rest)
  parts = [...parts, ...body]
  if (suf) parts.push(suf)

  parts = parts.filter(Boolean)
  // 校验：拼回去必须等于原词，且至少两段才有意义
  if (parts.length < 2 || parts.join('') !== w) return [word]
  return parts
}

/** 渲染用：wea·ther 形式（拆不出就返回原词） */
export function syllableText(word: string): string {
  const parts = splitSyllables(word)
  return parts.length > 1 ? parts.join('·') : word
}
