/**
 * GET /api/wordbook-words?id=wb_xxx
 * 返回自定义册子的词单明细（[{word, cn}]）。前端动态任务（每日计划/
 * 智能混合卷）按激活册子取词用。内置册子不走这里（前端直接用打包词表）。
 */
import { type Env, ok, fail, preflight } from './_utils'

interface BookRow { id: string; name: string; words: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const id = new URL(request.url).searchParams.get('id') || ''
    if (!/^wb_[a-z0-9]+$/.test(id)) return fail('非法 id', 400)
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS wordbooks (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         words TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`
    ).bind().run()
    const row = await env.DB.prepare(
      `SELECT id, name, words FROM wordbooks WHERE id = ?`
    ).bind(id).first<BookRow>()
    if (!row) return fail('册子不存在', 404)
    let words: { word: string; cn: string }[] = []
    try { words = JSON.parse(row.words) as { word: string; cn: string }[] } catch { /* 容错 */ }
    return ok({ id: row.id, name: row.name, words })
  } catch (e) {
    return fail('读取失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
