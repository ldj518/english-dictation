import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import ProfileSwitcher from '../components/ProfileSwitcher'
import { useStore } from '../lib/store'
import { load } from '../lib/storage'
import { speechSupported } from '../lib/player'

export default function Settings() {
  const nav = useNavigate()
  const { progress, updateSettings, doReset, profiles, profile, updateProfile } = useStore()
  const s = progress.settings

  const exportData = () => {
    const blob = new Blob([JSON.stringify(load(profile.id), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `听写进度_${profile.name}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }

  const importData = (file: File) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        localStorage.setItem(`eng-dict-v1:${profile.id}`, String(r.result))
        location.reload()
      } catch { alert('导入失败') }
    }
    r.readAsText(file)
  }

  const renameProfile = (id: string, cur: string) => {
    const n = prompt('改成什么名字？', cur)
    if (n && n.trim()) updateProfile(id, { name: n.trim().slice(0, 8) })
  }

  const EMOJIS = ['🦁', '🐯', '🐼', '🦊', '🐨', '🐵', '🐧', '🦄', '🐳', '🌟']

  return (
    <Shell title="设置" back>
      {/* 孩子身份：切换走弹层（与首页一致）；下方列表只管改名/头像，不再负责切换 */}
      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 4 }}>👦👧 孩子身份</div>
        <div className="sub small" style={{ marginBottom: 12 }}>
          每个孩子的进度、错词本、成绩都是独立的。要换人点上面的身份按钮。
        </div>
        <div className="profileBar" style={{ marginBottom: 6 }}>
          <ProfileSwitcher />
        </div>
        {profiles.map(p => (
          <div key={p.id} className="field">
            <div className="row" style={{ gap: 10 }}>
              <div className="pChip" style={{ borderColor: p.id === profile.id ? p.color : undefined, cursor: 'default' }}>
                <span className="pe">{p.emoji}</span>
                <span className="pn">{p.name}</span>
                {p.id === profile.id && <span className="small" style={{ color: p.color }}>· 当前</span>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <select
                  value={p.emoji}
                  onChange={e => updateProfile(p.id, { emoji: e.target.value })}
                  style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 6px', background: '#fff' }}
                >
                  {EMOJIS.map(em => <option key={em} value={em}>{em}</option>)}
                </select>
                <button className="btn ghost sm" onClick={() => renameProfile(p.id, p.name)}>改名</button>
              </div>
            </div>
          </div>
        ))}
        <div className="sub small" style={{ marginTop: 2, lineHeight: 1.6 }}>
          换头像、改名字：直接在对应孩子那行操作。
        </div>
      </div>

      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>🔊 听写音频</div>

        <div className="field">
          <div>
            <div className="k">播放速度</div>
            <div className="d">听不清时调慢</div>
          </div>
          <div className="seg">
            {[0.75, 0.9, 1, 1.15].map(r => (
              <button key={r} className={s.rate === r ? 'on' : ''} onClick={() => updateSettings({ rate: r })}>
                {r}×
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div>
            <div className="k">每词播报遍数</div>
            <div className="d">默认播 2 遍，给足反应时间</div>
          </div>
          <div className="seg">
            {[1, 2, 3].map(r => (
              <button key={r} className={s.repeat === r ? 'on' : ''} onClick={() => updateSettings({ repeat: r })}>
                {r} 遍
              </button>
            ))}
          </div>
        </div>

        {/* v2.8：管控项收归家长中心，孩子端只读显示（防止自己改规则） */}
        <div className="field">
          <div>
            <div className="k">预习环节</div>
            <div className="d">{s.prepMode === 'off' ? '关闭：进来直接听写' : s.prepMode === 'force' ? '必须先预习才能听写' : '推荐预习，可自己选择跳过'}</div>
          </div>
          <span className="pill p-ok">{s.prepMode === 'off' ? '直接听写' : s.prepMode === 'force' ? '必须先学' : '可跳过'}</span>
        </div>

        <div className="field">
          <div>
            <div className="k">随机出题顺序</div>
            <div className="d">{s.shuffle ? '每天、每人的题目顺序都不一样' : '顺序固定'}</div>
          </div>
          <span className="pill p-ok">{s.shuffle ? '开' : '关'}</span>
        </div>

        <div className="field">
          <div>
            <div className="k">内置字母键盘</div>
            <div className="d">只有 26 个字母，不弹输入法联想词</div>
          </div>
          <span className="pill p-ok">{s.kbBuiltIn !== false ? '开' : '关'}</span>
        </div>

        <div className="field">
          <div>
            <div className="k">纸质伴写</div>
            <div className="d">听写时提示「写在听写本第 N 行」</div>
          </div>
          <span className="pill p-ok">{s.syncPaper !== false ? '开' : '关'}</span>
        </div>

        <div className="sub small" style={{ lineHeight: 1.7, margin: '4px 0 10px' }}>
          这几项由家长统一管理，所有设备同步生效。要改到家长中心。
        </div>
        <button className="btn ghost sm" onClick={() => nav('/parent')}>去家长中心修改 →</button>

        <div className="field">
          <div>
            <div className="k">音质</div>
            <div className="d">当前 96kbps 高保真（无杂音）</div>
          </div>
          <span className="pill p-ok">96 kbps ✓</span>
        </div>

        <div className="field">
          <div>
            <div className="k">系统语音兜底</div>
            <div className="d">{speechSupported() ? '可用 · 音频加载失败时自动切换' : '当前浏览器不支持'}</div>
          </div>
          <span className={'pill ' + (speechSupported() ? 'p-ok' : 'p-bad')}>
            {speechSupported() ? '已启用' : '不可用'}
          </span>
        </div>
      </div>

      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>💾 数据</div>
        <div className="sub small" style={{ marginBottom: 12 }}>
          当前是「{profile.name}」的学习记录，存在这台设备上。换设备前建议导出备份。
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={exportData}>导出备份</button>
          <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
            导入备份
            <input type="file" accept=".json" hidden onChange={e => {
              const f = e.target.files?.[0]
              if (f) importData(f)
            }} />
          </label>
        </div>
      </div>

      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>📖 关于</div>
        <div className="sub small">
          鲁教版（五四学制）七年级上册 · 368 词 · 48 个听写任务。
          <br />音频为本地高保真合成（24kHz / 96kbps 单声道），已消除旧版 32kbps 的底噪。
          <br />支持在线听写 + 纸质卷打印 + 拍照批改 + 成绩海报分享。
        </div>
      </div>

      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 8, color: 'var(--bad)' }}>⚠️ 危险操作</div>
        <button className="btn bad" onClick={() => {
          if (confirm(`这会清空「${profile.name}」的全部学习记录、错词本和成就，无法恢复。确定吗？`)) {
            if (confirm('真的要清空吗？建议先导出备份。')) doReset()
          }
        }}>
          清空「{profile.name}」的进度
        </button>
      </div>

      <div className="center sub small" style={{ padding: '20px 0 60px' }}>
        Made for 好孩子 · v1.1
      </div>
    </Shell>
  )
}
