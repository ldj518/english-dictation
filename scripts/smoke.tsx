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

type Case = [string, string, React.ComponentType]

const CASES: Case[] = [
  ['首页', '/', Home],
  ['错词本', '/review', ReviewPage],
  ['词库', '/words', WordsPage],
  ['统计', '/stats', StatsPage],
  ['设置', '/settings', SettingsPage],
]

// 需要路由参数的页面
const PARAM_CASES: [string, React.ComponentType][] = [
  ['/d/day01', DictationPage],
  ['/exam/unit01', ExamPage],
  ['/print/day01', PrintSheetPage],
  ['/paper/day01', PaperPage],
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

// 带参数页面：需要 router 的 params，用 MemoryRouter 模拟
import { MemoryRouter } from 'react-router-dom'
for (const [path, C] of PARAM_CASES) {
  try {
    const html = renderToString(
      createElement(MemoryRouter, { initialEntries: [path] },
        createElement(StoreProvider, null, createElement(C))
      )
    )
    const ok = html.length > 200
    results.push(`  ${ok ? '✓' : '✗'} ${path.padEnd(12)} ${String(html.length).padStart(6)} 字节`)
    ok ? pass++ : fail++
  } catch (e) {
    results.push(`  ✗ ${path.padEnd(12)} 渲染异常: ${(e as Error).message}`)
    fail++
  }
}

console.log('── 页面渲染冒烟测试 ──')
console.log(results.join('\n'))
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
