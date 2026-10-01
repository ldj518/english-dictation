/**
 * POST /api/upload —— 上传纸质卷照片到 R2。
 *
 * 用 multipart/form-data，字段名 file。
 * 返回 key，客户端把 key 存进 session.photo_key。
 *
 * 照片用途：家长日后回看「孩子当时写的字」，也可作为进步对比。
 */
import { type Env, ok, fail, preflight, uid, dayKey } from './_utils'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  try {
    if (!env.BUCKET) return fail('未绑定 R2 桶（BUCKET）', 500)

    const form = await request.formData()
    const file = form.get('file')
    const studentId = (form.get('studentId') as string) || 'unknown'

    if (!file || typeof file === 'string') return fail('缺少文件（字段名 file）')

    const blob = file as File
    // 限制 5MB，避免滥用
    if (blob.size > 5 * 1024 * 1024) return fail('图片不能超过 5MB')

    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const key = `papers/${studentId}/${dayKey()}/${uid('p_')}.${ext}`

    await env.BUCKET.put(key, await blob.arrayBuffer(), {
      httpMetadata: { contentType: blob.type || 'image/jpeg' },
    })

    return ok({ key, size: blob.size })
  } catch (e) {
    return fail('上传失败: ' + (e as Error).message, 500)
  }
}

export const onRequestOptions: PagesFunction = async () => preflight()
