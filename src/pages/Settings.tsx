import Shell from '../components/Shell'
import { useStore } from '../lib/store'
import { load } from '../lib/storage'
import { speechSupported } from '../lib/player'

export default function Settings() {
  const { progress, updateSettings, doReset } = useStore()
  const s = progress.settings

  const exportData = () => {
    const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `听写进度_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }

  const importData = (file: File) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        localStorage.setItem('eng-dict-v1', String(r.result))
        location.reload()
      } catch { alert('导入失败') }
    }
    r.readAsText(file)
  }

  return (
    <Shell title="设置" back>
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
          学习记录存在这台设备上。换设备前建议导出备份。
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
        </div>
      </div>

      <div className="card pad">
        <div style={{ fontWeight: 800, marginBottom: 8, color: 'var(--bad)' }}>⚠️ 危险操作</div>
        <button className="btn bad" onClick={() => {
          if (confirm('这会清空全部学习记录、错词本和成就，无法恢复。确定吗？')) {
            if (confirm('真的要清空吗？建议先导出备份。')) doReset()
          }
        }}>
          重置全部进度
        </button>
      </div>

      <div className="center sub small" style={{ padding: '20px 0 60px' }}>
        Made for 好孩子 · v1.0
      </div>
    </Shell>
  )
}
