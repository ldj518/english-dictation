import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchShare, paperFileUrl, recordFileUrl, type SharePayload } from '../lib/api'

/**
 * 只读分享页（/s/:id）：家人点开微信里的链接就能看到对错和纸质卷照片。
 *
 * 设计约束：
 * - 链接即凭证，页面只读，不依赖孩子设备的任何本地数据
 * - 不显示应用导航（避免孩子从这里跳进其他页面）
 * - 数据是一份快照，生成后不随后续练习变化
 */
export default function Share() {
  const { id = '' } = useParams()
  const [data, setData] = useState<SharePayload | null>(null)
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState('')

  useEffect(() => {
    let cancel = false
    fetchShare(id).then(r => {
      if (cancel) return
      if (r && r.payload) setData(r.payload)
      else setErr('链接无效或已失效')
    })
    return () => { cancel = true }
  }, [id])

  const bg = '#f5f6fa'
  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 14, padding: 18,
    marginBottom: 14, border: '0.5px solid rgba(0,0,0,0.08)',
  }

  return (
    <div style={{ minHeight: '100vh', background: bg, padding: '24px 14px 60px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: '#8b93a3' }}>英语听写 · 学习报告</div>
        <div style={{ fontSize: 12, color: '#b3bac6', marginTop: 4 }}>tingxie.5208090.xyz</div>
      </div>

      {err && (
        <div style={{ ...card, textAlign: 'center', color: '#8b93a3' }}>
          <div style={{ fontSize: 30 }}>🔗</div>
          <div style={{ marginTop: 8, fontWeight: 600 }}>{err}</div>
        </div>
      )}

      {!data && !err && (
        <div style={{ ...card, textAlign: 'center', color: '#8b93a3' }}>加载中…</div>
      )}

      {data && (
        <>
          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>{data.emoji}</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{data.studentName}</div>
            <div style={{ fontSize: 13, color: '#8b93a3', marginTop: 2 }}>{data.title} · {data.date}</div>
            <div style={{ fontSize: 44, fontWeight: 800, color: data.score >= 80 ? '#2b8a3e' : data.score >= 60 ? '#1971c2' : '#e03131', margin: '10px 0 2px' }}>
              {data.score}<span style={{ fontSize: 20 }}>%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 10, fontSize: 13 }}>
              <span><b>{data.sessions}</b> 次</span>
              <span><b>{data.right}</b> / {data.total} 对</span>
              <span style={{ color: '#e03131' }}>错 {data.total - data.right}</span>
            </div>
            {typeof data.attemptNo === 'number' && data.attemptNo > 1 && (
              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: '#b45309', background: '#fff4e6', borderRadius: 8, padding: '5px 10px', display: 'inline-block' }}>
                ⚠️ 当天第 {data.attemptNo} 次提交（重做出来的分数）
              </div>
            )}
          </div>

          {(data.recordKeys || []).length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>🎙️ 跟读录音（点播放听孩子读的）</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.recordKeys!.map(r => (
                  <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, minWidth: 76 }}>{r.word}</span>
                    <audio controls preload="none" src={recordFileUrl(r.key)}
                      style={{ height: 34, flex: 1, maxWidth: '100%' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.wrongs.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>❌ 错词 {data.wrongs.length} 个</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.wrongs.map(w => (
                  <span key={w.word} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: '#fcebeb', color: '#a32d2d' }}>
                    {w.word} · {w.cn}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.photoKeys.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>📷 纸质卷照片</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {data.photoKeys.map(k => (
                  <img
                    key={k}
                    src={paperFileUrl(k)}
                    alt="纸质卷"
                    loading="lazy"
                    style={{ width: '100%', borderRadius: 10, cursor: 'zoom-in', border: '0.5px solid rgba(0,0,0,0.1)' }}
                    onClick={() => setZoom(k)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {zoom && (
        <div
          onClick={() => setZoom('')}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99, padding: 12 }}
        >
          <img src={paperFileUrl(zoom)} alt="纸质卷大图" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}
