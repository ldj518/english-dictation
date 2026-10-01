/**
 * GET  /api/wordbooks   自定义册子列表 + 当前激活册子 + 每日新词数
 * POST /api/wordbooks   管理操作
 *
 * body:
 *   { action: 'create', name, text }     家长粘贴词单创建册子（每行一个词）
 *   { action: 'delete', id }             删除自定义册子
 *   { action: 'setActive', id }          切换当前册子（'builtin7a' = 内置七上）
 *   { action: 'setDailyWords', n }       每日新词数（5/8/10/12/15）
 *
 * 粘贴格式（每行一个词，自动识别英文在行首或行尾）：
 *   hold on 别挂断电话；等一等
 *   别挂断电话 hold on
 *
 * 词单存 D1（wordbooks 表，首次访问自动建表），激活册子与每日词量
 * 存 app_settings —— 与 shuffle_mode 同机制，云端为准、多端一致。
 */
import { type Env, ok, fail, preflight } from './_utils'

const ACTIVE_KEY = 'active_book'
const DAILY_KEY = 'daily_words'
export const BUILTIN_ID = 'builtin7a'

interface BookRow { id: string; name: string; words: string; created_at: number }

async function ensureTable(env: Env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS wordbooks (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       words TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`
  ).bind().run()
}

async function readSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT value FROM app_settings WHERE key = ?`
  ).bind(key).first<{ value: string }>()
  return row?.value ?? null
}

async function writeSetting(env: Env, key: string, value: string) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, Date.now()).run()
}

export function uid(): string {
  return 'wb_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)
}

/** 解析粘贴的词单 → [{word, cn}]，识别失败的行丢弃并计数 */
export function parseWordText(text: string): { list: { word: string; cn: string }[]; bad: number } {
  const list: { word: string; cn: string }[] = []
  const seen = new Set<string>()
  let bad = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let word = ''
    let cn = ''
    if (/^[a-zA-Z]/.test(line)) {
      // 英文在行首：取行首的「字母/空格/连字符/撇号/点」段（词组允许内部空格）
      const m = /^([a-zA-Z][a-zA-Z'\-.]*(?:\s+[a-zA-Z][a-zA-Z'\-.]*)*)\s*[，,\t\s]\s*(.+)$/.exec(line)
      if (m) { word = m[1]; cn = m[2].trim() }
    }
    if (!word && /[a-zA-Z][^a-zA-Z]*$/.test(line)) {
      // 英文在行尾
      const m = /^(.+?)\s*[，,\t\s]\s*([a-zA-Z][a-zA-Z'\-.]*(?:\s+[a-zA-Z][a-zA-Z'\-.]*)*)$/.exec(line)
      if (m) { word = m[2]; cn = m[1].trim() }
    }
    if (!word) { bad++; continue }
    word = word.replace(/\s+/g, ' ').trim()
    if (!word || seen.has(word.toLowerCase())) { bad++; continue }
    seen.add(word.toLowerCase())
    list.push({ word, cn: cn.replace(/\s+/g, ' ') })
  }
  return { list, bad }
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    await ensureTable(env)
    const [rows, active, daily] = await Promise.all([
      env.DB.prepare(`SELECT id, name, words, created_at FROM wordbooks ORDER BY created_at DESC`).all<BookRow>(),
      readSetting(env, ACTIVE_KEY),
      readSetting(env, DAILY_KEY),
    ])
    return ok({
      books: (rows.results || []).map(r => ({
        id: r.id,
        name: r.name,
        count: (() => { try { return (JSON.parse(r.words) as unknown[]).length } catch { return 0 } })(),
      })),
      active: active || BUILTIN_ID,
      dailyWords: Math.max(3, Math.min(30, parseInt(daily || '10', 10) || 10)),
    })
  } catch (e) {
    return fail('读取失败: ' + (e as Error).message, 500)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureTable(env)
    const body = await request.json() as {
      action?: string; name?: string; text?: string; id?: string; n?: number
    }

    if (body.action === 'create') {
      const name = (body.name || '').trim().slice(0, 30)
      if (!name) return fail('册子名称不能为空')
      const { list, bad } = parseWordText(body.text || '')
      if (list.length < 5) return fail(`有效词条太少（解析到 ${list.length} 个，每行需含英文单词）`)
      const id = uid()
      await env.DB.prepare(
        `INSERT INTO wordbooks (id, name, words, created_at) VALUES (?,?,?,?)`
      ).bind(id, name, JSON.stringify(list), Date.now()).run()
      return ok({ id, count: list.length, skipped: bad })
    }

    if (body.action === 'delete') {
      const id = (body.id || '').trim()
      if (!id) return fail('缺少 id')
      await env.DB.prepare(`DELETE FROM wordbooks WHERE id = ?`).bind(id).run()
      // 若删的是激活册子，回落到内置七上
      if ((await readSetting(env, ACTIVE_KEY)) === id) {
        await writeSetting(env, ACTIVE_KEY, BUILTIN_ID)
      }
      return ok({ deleted: id })
    }

    if (body.action === 'setActive') {
      const id = (body.id || '').trim()
      if (!id) return fail('缺少 id')
      await writeSetting(env, ACTIVE_KEY, id)
      return ok({ active: id })
    }

    if (body.action === 'setDailyWords') {
      const n = Math.max(3, Math.min(30, Math.round(body.n || 0)))
      await writeSetting(env, DAILY_KEY, String(n))
      return ok({ dailyWords: n })
    }

    return fail('未知操作')
  } catch (e) {
    return fail('保存失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
