/**
 * POST /api/record?studentId=p1&trackId=day01&no=3&word=apple&ext=webm
 *   请求体 = 原始音频字节（MediaRecorder 产出的 webm/mp4）
 *   → 存 R2：records/{studentId}/{dayKey}/{trackId}/{no}-{word}-{uid}.{ext}
 *
 * GET /api/record?studentId=p1
 *   列出该孩子的跟读录音（家长看板 / 分享页用），音频本体走 /api/record-file。
 */
import { type Env, ok, fail, preflight, dayKey, uid } from './_utils'

const MAX_BYTES = 2 * 1024 * 1024 // 单条录音上限 2MB（一个单词跟读 2-6 秒，opus 通常 <20KB）

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.BUCKET) return fail('未绑定 R2 桶（BUCKET）', 500)
    const url = new URL(request.url)
    const studentId = (url.searchParams.get('studentId') || '').trim()
    const trackId = (url.searchParams.get('trackId') || '').trim()
    const no = parseInt(url.searchParams.get('no') || '', 10)
    const word = (url.searchParams.get('word') || '').trim()
    const ext = (url.searchParams.get('ext') || 'webm').trim()

    if (!/^[a-zA-Z0-9_-]{1,24}$/.test(studentId)) return fail('studentId 不合法')
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(trackId)) return fail('trackId 不合法')
    if (!Number.isInteger(no) || no < 1 || no > 99) return fail('题号不合法')
    // 单词只留字母/撇号/连字符，防止在对象键里塞路径符
    const safeWord = word.replace(/[^a-zA-Z'-]/g, '').slice(0, 40)
    if (!safeWord) return fail('单词不合法')
    if (!['webm', 'mp4', 'ogg', 'wav'].includes(ext)) return fail('音频格式不支持')
    // ⚠️ Content-Length 必须转数字再比：字符串比较下 "4" > "2097152"（字典序），
    // 会出现 4 字节也被判「录音太大」的假拒绝（线上实测踩过）
    const contentLen = parseInt(request.headers.get('Content-Length') || '0', 10)
    if (contentLen > MAX_BYTES) return fail('录音太大了', 413)

    const buf = await request.arrayBuffer()
    if (!buf.byteLength) return fail('空的录音')
    if (buf.byteLength > MAX_BYTES) return fail('录音太大了', 413)

    const key = `records/${studentId}/${dayKey()}/${trackId}/${String(no).padStart(2, '0')}-${safeWord}-${uid('')}.${ext}`
    await env.BUCKET.put(key, buf, {
      httpMetadata: { contentType: ext === 'mp4' ? 'audio/mp4' : `audio/${ext}` },
    })
    return ok({ key })
  } catch (e) {
    return fail('上传录音失败: ' + (e as Error).message, 500)
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.BUCKET) return fail('未绑定 R2 桶（BUCKET）', 500)
    const url = new URL(request.url)
    const studentId = (url.searchParams.get('studentId') || '').trim()
    if (!studentId) return fail('缺少 studentId')

    const list = await env.BUCKET.list({ prefix: `records/${studentId}/`, limit: 500 })
    const recordings = list.objects
      .map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded.getTime() }))
      .sort((a, b) => b.uploaded - a.uploaded)
    return ok({ recordings, truncated: list.truncated })
  } catch (e) {
    return fail('读取录音列表失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
