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
import GamesPage from '../src/pages/Games'
import MatchPage from '../src/pages/Match'
import MonsterPage from '../src/pages/Monster'
import LearnPage from '../src/pages/Learn'
import ListenPage from '../src/pages/Listen'
import SpellPage from '../src/pages/Spell'
import UnitTestPage from '../src/pages/UnitTest'
import MasteryPage from '../src/pages/Mastery'
import FormsPage from '../src/pages/Forms'
import DaysPage from '../src/pages/Days'
import HallPage from '../src/pages/Hall'
import ExtraPage from '../src/pages/Extra'

type Case = [string, string, React.ComponentType]

const CASES: Case[] = [
  ['首页', '/', Home],
  ['考场', '/hall', HallPage],     // v3.5：单元/期末/每日任务墙 + 纸质工具
  ['专项', '/extra', ExtraPage],   // v3.5：混合卷/短语/词形/地图
  ['错词本', '/review', ReviewPage],
  ['词库', '/words', WordsPage],
  ['统计', '/stats', StatsPage],
  ['设置', '/settings', SettingsPage],
  ['家长看板', '/parent', ParentPage],
  ['掌握地图', '/map', MasteryPage],
  ['词形变换', '/forms/all', FormsPage],
  ['选日子', '/days', DaysPage],
  ['训练场', '/train', TrainPage],
  ['游戏中心', '/games', GamesPage],
  ['连连看', '/games/match', MatchPage],
  ['错词大作战', '/games/monster', MonsterPage],
]

// 需要路由参数的页面
const PARAM_CASES: [string, React.ComponentType][] = [
  ['/d/day01', DictationPage],
  ['/d/plan', DictationPage],   // 每日计划（动态任务）
  ['/d/mix', DictationPage],    // 智能混合卷（动态任务）
  ['/learn/day01', LearnPage],  // 学习环节（预习卡片流）
  ['/learn/plan', LearnPage],   // 学习环节 · 每日计划（动态任务）
  ['/listen/day01', ListenPage], // 纯纸听（音频播放器，屏幕零词形）
  ['/spell/day01', SpellPage],   // 首字母填空（中文释义 + 首字母提示）
  ['/exam/unit01', ExamPage],
  ['/test/unit01', UnitTestPage],  // 单元过关测试（三段混合卷，SSR 渲染卷面说明+开始门）
  ['/test/unit99', UnitTestPage],  // 不存在的单元 → 空态页
  ['/print/day01', PrintSheetPage],
  ['/print/plan', PrintSheetPage],
  ['/paper/day01', PaperPage],
  ['/translate/day01', TranslatePage],
  ['/translate/plan', TranslatePage],
  ['/read/day01', ReadPage],
  ['/read/plan', ReadPage],     // v3.5.1 回归：闯关第 3 关入口，之前不支持 plan 显示「没有这个任务」
  ['/listen/plan', ListenPage], // 考场「纸听一遍」直达 plan
  ['/paper/plan', PaperPage],   // 考场「纸质批改」直达 plan，之前同样不支持
  ['/learn/wcustom', LearnPage],     // v3.6 错词五关：无词单时引导回错词本
  ['/translate/wcustom', TranslatePage],
  ['/d/wcustom', DictationPage],
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

// 首页 v3.5 特征断言：三区结构（闯关主区 + 状态行 + 四宫格），旧卡必须删干净
{
  const html = render('/', Home)
  // 空进度 SSR 状态：step=1 → 显示「Today · 第 1 关」+「开始今天的闯关」
  const must = ['Today · 第', '开始今天的闯关', '三件事', '今日纸质卷', '考场', '专项', '游戏', '家长']
  const mustNot = ['智能混合卷', '短语专项', '成就墙', '今日任务']  // 已迁去 /hall /extra /stats
  const miss = must.filter(k => !html.includes(k))
  const leak = mustNot.filter(k => html.includes(k))
  const ok = miss.length === 0 && leak.length === 0
  results.push(`  ${ok ? '✓' : '✗'} 首页三区特征${miss.length ? ` 缺:${miss.join(',')}` : ''}${leak.length ? ` 残留:${leak.join(',')}` : ''}`)
  ok ? pass++ : fail++
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
  '/learn/plan': '正在准备今天的词单',
  '/listen/day01': '纸听模式',
  '/spell/day01': '首字母填空',
  '/test/unit01': '卷面说明',
  '/test/unit99': '没有这个单元',
  '/print/plan': '正在准备今天的词单',
  '/translate/plan': '正在准备今天的词单',
  '/translate/day01': '加载中',
  '/read/day01': '加载中',
  '/read/plan': '正在准备今天的词单',
  '/listen/plan': '正在准备今天的词单',
  '/paper/plan': '正在准备今天的词单',
  '/learn/wcustom': '还没有选词',
  '/translate/wcustom': '还没有选词',
  '/d/wcustom': '还没有选词',
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
