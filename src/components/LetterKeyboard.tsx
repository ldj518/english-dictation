/**
 * 内置 26 键字母键盘（无联想）。
 *
 * 为什么不用系统键盘：手机输入法自带「猜词补全」，孩子点前两个字母，
 * 整个单词就弹在候选栏里，等于提示答案——听写就废了。
 * 这个键盘只有字母本身，从根上杜绝联想。
 *
 * 键位按词库定制（manifest 368 词实测）：
 * - 空格：87 个词组（hold on / take a message…）必须能输
 * - 连字符与斜杠：paper-cut / Mid-Autumn Festival / sb/sth（judge 判分不剔除这两个符号）
 * - 撇号不用放：judge 归一化时剔除所有标点，one's 与 ones 判等
 * - 大写不用放：judge 忽略大小写
 *
 * inputMode="none" 保证点输入框不弹系统键盘；桌面物理键盘不受影响，
 * 原有 onChange/Enter 逻辑保留，两头都能用。
 */
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

export default function LetterKeyboard({
  onKey,
  onBackspace,
  onSubmit,
  disabled,
}: {
  onKey: (ch: string) => void
  onBackspace: () => void
  onSubmit: () => void
  disabled?: boolean
}) {
  const tap = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault() // 防触摸双击缩放/长按选中
    if (disabled) return
    try { navigator.vibrate?.(8) } catch { /* 桌面无振动，忽略 */ }
    fn()
  }

  return (
    <div className="kb" role="group" aria-label="字母键盘">
      {ROWS.map((row, ri) => (
        <div className={'kb-row' + (ri === 1 ? ' kb-row-2' : ri === 2 ? ' kb-row-3' : '')} key={row}>
          {ri === 2 && (
            <button type="button" className="kb-key kb-wide" onClick={tap(onBackspace)} aria-label="退格">⌫</button>
          )}
          {row.split('').map(c => (
            <button type="button" key={c} className="kb-key" onClick={tap(() => onKey(c))}>
              {c}
            </button>
          ))}
          {ri === 2 && (
            <button type="button" className="kb-key kb-go" onClick={tap(onSubmit)} aria-label="确认">✓</button>
          )}
        </div>
      ))}
      <div className="kb-row">
        <button type="button" className="kb-key kb-space" onClick={tap(() => onKey(' '))}>空格</button>
        <button type="button" className="kb-key kb-narrow" onClick={tap(() => onKey('-'))}>-</button>
        <button type="button" className="kb-key kb-narrow" onClick={tap(() => onKey('/'))}>/</button>
        <button type="button" className="kb-key kb-narrow" onClick={tap(onBackspace)} aria-label="退格">⌫</button>
      </div>
    </div>
  )
}
