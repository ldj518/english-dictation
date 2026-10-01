/** SSR 冒烟测试：在 Node 里真实渲染每个页面组件，捕获运行时错误。
 *  这是无浏览器环境下最接近「打开页面」的验证手段。
 */
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { StaticRouter } from 'react-router-dom/server.js'
import { StoreProvider } from '../src/lib/store'
import Home from '../src/pages/Home'
import DictationPage from '../src/pages/Dictation'
import ReviewPage from '../src/pages/Review'
import ExamPage from '../src/pages/Exam'
import StatsPage from '../src/pages/Stats'
import WordsPage from '../src/pages/Words'
import SettingsPage from '../src/pages/Settings'
import PrintSheetPage from '../src/pages/PrintSheet'
import PaperPage from '../src/pages/Paper'
import ParentPage from '../src/pages/Parent'
import TrainPage from '../src/pages/Train'
import TranslatePage from '../src/pages/Translate'
import ReadPage from '../src/pages/Read'
import SharePage from '../src/pages/Share'

type Case = [string, string, React.ComponentType]

const CASES: Case[] = [
  ['首页', '/', Home],
  ['错词本', '/review', ReviewPage],
  ['词库', '/words', WordsPage],
  ['统计', '/stats', StatsPage],
  ['设置', '/settings', SettingsPage],
  ['家长看板', '/parent', ParentPage],
  ['训练场', '/train', TrainPage],
]

// 需要路由参数的页面
const PARAM_CASES: [string, React.ComponentType][] = [
  ['/d/day01', DictationPage],
  ['/d/plan', DictationPage],   // 每日计划（动态任务）
  ['/d/mix', DictationPage],    // 智能混合卷（动态任务）
  ['/exam/unit01', ExamPage],
  ['/print/day01', PrintSheetPage],
  ['/print/plan', PrintSheetPage],
  ['/paper/day01', PaperPage],
  ['/translate/day01', TranslatePage],
  ['/translate/plan', TranslatePage],
  ['/read/day01', ReadPage],
  ['/s/sh_test123', SharePage],
]

function render(path: string, C: React.ComponentType): string {
  return renderToString(
    createElement(StaticRouter, { location: path },
      createElement(StoreProvider, null, createElement(C))
    )
  )
}

let pass = 0, fail = 0
const results: string[] = []

for (const [name, path, C] of CASES) {
  try {
    const html = render(path, C)
    const ok = html.length > 200
    results.push(`  ${ok ? '✓' : '✗'} ${name.padEnd(8)} ${String(html.length).padStart(6)} 字节`)
    ok ? pass++ : fail++
  } catch (e) {
    results.push(`  ✗ ${name.padEnd(8)} 渲染异常: ${(e as Error).message}`)
    fail++
  }
}

// 带参数页面：必须套一层匹配的 <Route>，否则 useParams() 拿不到 id，
// 页面会走「没有这个任务」分支（以前空渲染碰巧超过 200 字节，是假阳性）
import { MemoryRouter, Routes, Route } from 'react-router-dom'

function renderParam(path: string, C: React.ComponentType): string {
  const pattern = '/' + path.split('/')[1] + '/:id'
  return renderToString(
    createElement(MemoryRouter, { initialEntries: [path] },
      createElement(StoreProvider, null,
        createElement(Routes, null,
          createElement(Route, { path: pattern, element: createElement(C) })))))
}

// SSR 里 effect 不执行：动态任务/异步词单渲染出「加载中」是正确行为，
// 用「预期标记」判定，其余页面仍要求 >200 字节的完整渲染
const EXPECTED: Record<string, string> = {
  '/d/plan': '正在准备今天的词单',
  '/d/mix': '正在准备今天的词单',
  '/print/plan': '正在准备今天的词单',
  '/translate/plan': '正在准备今天的词单',
  '/translate/day01': '加载中',
  '/read/day01': '加载中',
}

for (const [path, C] of PARAM_CASES) {
  try {
    const html = renderParam(path, C)
    const expect = EXPECTED[path]
    const ok = expect ? html.includes(expect) : html.length > 200
    results.push(`  ${ok ? '✓' : '✗'} ${path.padEnd(12)} ${String(html.length).padStart(6)} 字节${expect ? `（预期：${expect}）` : ''}`)
    ok ? pass++ : fail++
  } catch (e) {
    results.push(`  ✗ ${path.padEnd(12)} 渲染异常: ${(e as Error).message}`)
    fail++
  }
}

// ── 回归：应用是 BrowserRouter（History 模式），页面里绝不允许出现 hash 链接 ──
// <a href="#/xxx"> 在 BrowserRouter 下点击不会触发路由导航（只会改地址栏的 #），
// 表现为「按钮点了没反应」。历史上「打纸质卷」「纸质批改」全中过招，必须机器拦截。
{
  let bad = 0
  const all: [string, () => string][] = [
    ...CASES.map(([p, , C]) => [p, () => render(p, C)] as [string, () => string]),
    ...PARAM_CASES.map(([p, C]) => [p, () => renderParam(p, C)] as [string, () => string]),
  ]
  for (const [path, fn] of all) {
    try {
      const html = fn()
      if (/href="#\//.test(html)) {
        results.push(`  ✗ ${path} 含 hash 链接 href="#/..."（BrowserRouter 下点了不会跳转）`)
        bad++
      }
    } catch { /* 渲染异常已在上面统计过 */ }
  }
  if (bad === 0) {
    results.push('  ✓ 全部页面无 hash 链接（BrowserRouter 兼容）')
    pass++
  } else {
    fail++
  }
}

console.log('── 页面渲染冒烟测试 ──')
console.log(results.join('\n'))
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
