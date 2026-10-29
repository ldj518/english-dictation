/**
 * 英语听写 · Service Worker（v8）
 *
 * 为什么要有它：
 *   国内访问 Cloudflare 落在洛杉矶，晚上实测 TLS 握手 0.6–4.3 秒、首屏 TTFB
 *   1.1–9.2 秒、5 次里 1 次 25 秒超时。孩子的设备每次打开都要重新走一趟
 *   跨境去拿 HTML、730KB 的 JS 包和当场的 30 个音频，卡是必然的。
 *
 *   上了 SW 之后：第二次打开直接吃本地缓存（≈0 秒），断网也能做题，
 *   音频只下一次。网络只负责「后台把新版本和数据换进来」。
 *
 * 缓存策略（每条都有理由，别随便改）：
 *   · /assets/*  —— 文件名带内容哈希，cache-first 永久。改一个字节文件名就变了，
 *                   不存在「缓存了旧代码」的风险。
 *   · /audio/*   —— cache-first。一个词 24–30KB，一场课约 0.9MB，
 *                   重复做同一个词不该再跨境拉一次。跨版本保留（见 AUDIO_CACHE）。
 *   · 页面导航    —— network-first + 3.5 秒超时。超时就用缓存壳，
 *                   否则弱网下孩子盯着白屏等 9 秒。新版本靠 SW 自己更新换壳。
 *   · /api/*     —— 不缓存、不拦截。作答和进度是「事实来源在服务端」，
 *                   缓存了反而会让家长看到过期的账，而且离线补发由
 *                   answerQueue 那一层负责，SW 不掺和。
 *
 * 版本号与预缓存清单由 scripts/gen-sw.mjs 在构建时注入，不要手改。
 */

const VERSION = '__VERSION__'
const SHELL_URLS = __PRECACHE__

const SHELL_CACHE = 'shell-' + VERSION
/** 音频跨版本保留：发一次版就重下几十 MB 太蠢，而且音频内容基本不变 */
const AUDIO_CACHE = 'audio-v1'
/** 一次最多留多少个音频。2733 个文件全留约 70MB，手机扛得住，
 *  但保守一点按 800 个封顶，超了先删最早进的。 */
const AUDIO_MAX = 800

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    // 逐个加：某个文件 404 不能把整个 install 拖死
    await Promise.all(SHELL_URLS.map(u => cache.add(u).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys.filter(k => k.startsWith('shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))
    )
    await pruneAudio()
    await self.clients.claim()
  })())
})

async function pruneAudio() {
  try {
    const cache = await caches.open(AUDIO_CACHE)
    const keys = await cache.keys()
    if (keys.length <= AUDIO_MAX) return
    // Cache API 的 keys() 按插入顺序返回，先删最旧的
    for (const req of keys.slice(0, keys.length - AUDIO_MAX)) await cache.delete(req)
  } catch { /* 配额/权限问题：留着缓存比删错好 */ }
}

/** 带超时的网络优先；超时或失败回落到缓存 */
async function networkFirst(req, cacheName, fallbackUrl, timeoutMs) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req, { ignoreSearch: true })
  const net = fetch(req).then(async (res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
    return res
  })
  if (!hit) return net.catch(() => new Response('', { status: 504 }))

  const timeout = new Promise(resolve => setTimeout(() => resolve('__timeout__'), timeoutMs))
  const winner = await Promise.race([net.catch(() => '__fail__'), timeout])
  if (winner === '__timeout__' || winner === '__fail__') {
    return hit || (fallbackUrl ? (await cache.match(fallbackUrl)) || hit : hit)
  }
  return winner
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // 接口一律直连，别拦
  if (url.pathname.startsWith('/api/')) return

  // 页面导航：弱网优先出壳，别让孩子等白屏
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL_CACHE, '/index.html', 3500))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, SHELL_CACHE))
    return
  }
  if (url.pathname.startsWith('/audio/')) {
    event.respondWith(cacheFirst(req, AUDIO_CACHE))
    return
  }
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirst(req, SHELL_CACHE))
    return
  }
})
