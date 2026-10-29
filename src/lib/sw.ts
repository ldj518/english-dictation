/**
 * Service Worker 注册（v8）。
 *
 * 只做三件事：注册、失败静默、用构建指纹当查询串。
 *
 * 为什么要带 `?v=`：
 *   Pages 给静态文件默认 `max-age=14400`，而且实测 `/sw.js` 上写的
 *   `_headers` 规则不生效（同一个文件里 `/`、`/assets/*` 都生效了，
 *   只有根目录这个 js 没有）。结果是：发版之后边缘还在发 4 小时前的
 *   `/sw.js`——客户端拿到的还是旧壳版本号，怎么刷新都换不掉。
 *   拿当前主包的文件名当查询串，每次发版就是一个新 URL，边缘缓存键跟着变，
 *   一定拿到最新的那份；`updateViaCache:'none'` 再兜住浏览器自己那层缓存。
 *
 * 为什么不用固定路径 + 手动改版本号：
 *   会忘。忘了就等于发版不生效，而这种问题在手机上几乎查不出来。
 */

/** 从页面自己的 <script>/<link rel=modulepreload> 里取主包名，作为构建指纹 */
function buildTag(): string {
  try {
    const el = document.querySelector('script[type="module"][src^="/assets/"]')
      || document.querySelector('link[rel="modulepreload"][href^="/assets/"]')
    const url = el?.getAttribute('src') || el?.getAttribute('href') || ''
    const m = /index-([A-Za-z0-9_-]+)\.js/.exec(url)
    if (m) return m[1]
  } catch { /* 拿不到就退回时间戳，至少能绕过缓存 */ }
  return String(Date.now())
}

export function registerSW(): void {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  // 只在安全上下文注册。用 isSecureContext 而不是自己拼 host 判断——
  // 第一版写的是「https 或 hostname==='localhost'」，本机用 127.0.0.1 验收时
  // 直接被这句挡掉，表现成「SW 装不上」，白查半天。
  if (!window.isSecureContext) return

  const url = `/sw.js?v=${buildTag()}`

  let done = false
  const go = () => {
    if (done) return
    done = true
    navigator.serviceWorker.register(url, { updateViaCache: 'none' }).catch(() => {
      // 注册失败不影响使用，只是没有离线能力
    })
  }

  // 正常情况等 load 完再注册，别和首屏抢带宽。
  // 但弱网下 load 可能几十秒都不触发（实测首屏资源要 90 秒），
  // 只挂在 load 上等于「网越差越装不上 SW」——正好反了。
  // 所以加一个 8 秒兜底：先装，装完立刻就有离线能力。
  if (document.readyState === 'complete') go()
  else {
    window.addEventListener('load', go, { once: true })
    window.setTimeout(go, 8000)
  }
}
