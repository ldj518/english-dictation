/**
 * 首页的「单元闸门」入口卡。
 *
 * 只在两种情况下出现：
 *  · 四条触发条件满足 → 亮「可以考了」
 *  · 有过一次不过、正在补丁期 → 灰着并显示还剩几天（让孩子知道「不是我偷懒」）
 * 其他情况整卡不渲染——天天挂一张「还不能考」，等于给他一个永远点不动的按钮。
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { todayStr } from '../lib/storage'
import { cnOf } from '../lib/qbank'
import { dueWordList } from '../lib/memory'
import { gateOf, patchLeft, unitName, UNITS, GATE_PASS, SPELL_PASS } from '../lib/gate'


export default function GateCard() {
  const nav = useNavigate()
  const { progress } = useStore()
  const day = todayStr()

  const info = useMemo(() => {
    const dueAll = dueWordList(progress, day, cnOf).length
    const ready: string[] = []
    let patch: { unit: string; left: number } | null = null
    for (const u of UNITS) {
      const g = gateOf(progress, u, day, dueAll)
      if (g.ready) ready.push(u)
      else if (g.patchLeft > 0 && !patch) patch = { unit: u, left: patchLeft(progress, u, day) }
    }
    return { ready, patch }
  }, [progress, day])

  const { ready, patch } = info

  if (ready.length > 0) {
    const u = ready[0]
    return (
      <div className="card pad v4home" style={{ marginTop: 12, borderColor: 'var(--gold)' }}>
        <div className="between">
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>📕 {unitName(u)} 可以过关了</div>
            <div className="sub small" style={{ marginTop: 3 }}>
              总分 {GATE_PASS} + 拼写 {SPELL_PASS} 才算过。不过就进 3 天补丁期。
            </div>
          </div>
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => nav('/gate/' + u)}>
          去考 {unitName(u)}
        </button>
      </div>
    )
  }

  if (patch) {
    return (
      <div className="card pad" style={{ marginTop: 12, opacity: 0.75 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>📕 {unitName(patch.unit)} 补丁期</div>
        <div className="sub small" style={{ marginTop: 3 }}>
          还有 {patch.left} 天。这 3 天只补这个单元的弱词，补完闸门自己会开。
        </div>
      </div>
    )
  }

  return null
}
