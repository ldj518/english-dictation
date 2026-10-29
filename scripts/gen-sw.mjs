/**
 * 构建后生成 dist/sw.js。
 *
 * 为什么不在 public/ 里放一个写死的 sw.js：
 *   预缓存清单必须包含本次构建的哈希文件名（index-XXXX.js），
 *   手写就只能靠人肉维护，发一次版忘一次，离线就等于没做。
 *   版本号用文件名拼出来，内容一变 VERSION 就变，旧的 shell 缓存自动清掉。
 *
 * 用法：vite build 之后自动跑（见 package.json 的 build 脚本）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'dist')

if (!fs.existsSync(DIST)) {
  console.error('[gen-sw] dist 不存在，先跑 vite build')
  process.exit(1)
}



/**
 * 只预缓存本次构建真正被 index.html 引用的资源。
 *
 * 为什么不能直接扫 dist/assets：项目的 vite 配置是 emptyOutDir:false
 * （音频是独立产物，怕被清掉），所以 assets 目录里堆着历次构建的旧包——
 * 实测 57 个文件里只有 3 个是这次的。全塞进预缓存的话，install 时会去
 * 拉 50 多个已经 404 的文件，每个都是一趟跨境请求，等于把「离线加速」
 * 做成了「首装更慢」。
 */
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
const assets = [...new Set(
  [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1])
)].filter(p => fs.existsSync(path.join(DIST, p.replace(/^\//, ''))))

if (!assets.length) console.warn('[gen-sw] index.html 里没找到 /assets/ 引用，只预缓存壳')

// 图标：manifest 里列的抓不到，按目录扫
const iconsDir = path.join(DIST, 'icons')
const icons = fs.existsSync(iconsDir)
  ? fs.readdirSync(iconsDir).filter(f => /\.(png|svg|ico)$/i.test(f)).map(f => '/icons/' + f)
  : []

// 壳：'/' 与 '/index.html' 是同一份内容，两个都预缓存，导航回落时不用猜
const precache = ['/', '/index.html', '/manifest.json', ...icons, ...assets]

const VERSION = crypto
  .createHash('sha256')
  .update(precache.join('|'))
  .digest('hex')
  .slice(0, 10)

const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'sw-template.js'), 'utf8')
const out = tpl
  .replace("'__VERSION__'", JSON.stringify(VERSION))
  .replace('__PRECACHE__', JSON.stringify(precache, null, 2))

fs.writeFileSync(path.join(DIST, 'sw.js'), out)
console.log(`[gen-sw] dist/sw.js 版本 ${VERSION}，预缓存 ${precache.length} 个文件`)
