import { NavLink, Navigate, Route, Routes, BrowserRouter } from 'react-router-dom'
import { Badge, Button, Input, Switch } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from './store'
import { resetDemo } from './store/haccpSlice'
import { resetTerminal, setConflict, setSimulateFailure, setTerminalName } from './store/terminalSlice'
import { Overview } from './views/Overview'
import { ProcessControl } from './views/ProcessControl'
import { DeviationWorkbench } from './views/DeviationWorkbench'
import { AuditTrail } from './views/AuditTrail'

const navigation = [
  ['/', '生产批次'],
  ['/process', 'HACCP控制矩阵'],
  ['/deviations', '偏差调查'],
  ['/audit', '追溯审计']
]

function TerminalStrip() {
  const dispatch = useDispatch<AppDispatch>()
  const terminal = useSelector((state: RootState) => state.terminal)
  return (
    <div className="terminal-strip">
      <div className="terminal-id">
        <span>本机终端</span>
        <Input size="small" value={terminal.terminalName} onChange={(_, data) => dispatch(setTerminalName(data.value))} aria-label="终端名称" />
        <small>{terminal.terminalId}</small>
      </div>
      <div className="terminal-toggle">
        <Switch label="模拟本地写入失败（读数进恢复队列）" checked={terminal.simulateFailure} onChange={(_, data) => dispatch(setSimulateFailure(data.checked))} />
        {terminal.outbox.length > 0 && <Badge appearance="filled" color="warning">{terminal.outbox.length} 个监测点待补传</Badge>}
      </div>
      <div className="terminal-hint">打开两个浏览器标签页即模拟两台终端，可验证同一批次结论先到者生效。</div>
    </div>
  )
}

function ConflictBand() {
  const dispatch = useDispatch<AppDispatch>()
  const conflict = useSelector((state: RootState) => state.terminal.conflict)
  if (!conflict) return null
  return (
    <div className="conflict-band">
      <strong>提交冲突：{conflict.batchId}</strong>
      <span>{conflict.otherTerminalName} 已先完成「{conflict.action}」（结论版本 V{conflict.baseSeq} → V{conflict.currentSeq}，{conflict.at.replace('T', ' ').slice(0, 16)}）。先到者已生效，您的填值保留在批次面板的草稿中，核对后可重新提交。</span>
      <Button size="small" appearance="transparent" onClick={() => dispatch(setConflict(null))}>知道了</Button>
    </div>
  )
}

function Shell() {
  const dispatch = useDispatch<AppDispatch>()
  const openDeviations = useSelector((state: RootState) => state.haccp.deviations.filter((item) => item.status !== '已关闭').length)
  const pendingConfirm = useSelector((state: RootState) => {
    const closed = state.haccp.deviations.filter((item) => item.status === '已关闭')
    return closed.filter((item) => !state.haccp.batches.find((b) => b.id === item.batchId)?.monitoring.some((m) => m.id === item.confirmationReadingId)).length
  })
  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><b>H</b><div><strong>食品安全控制台</strong><small>HACCP批次与偏差追溯</small></div></div>
        <nav>{navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}><span>{label}</span>{label === '偏差调查' && (openDeviations + pendingConfirm > 0) && <Badge appearance="filled" color="danger">{openDeviations}{pendingConfirm > 0 ? `+${pendingConfirm}待确认` : ''}</Badge>}</NavLink>)}</nav>
        <div className="aside-note"><strong>统一生效依据</strong><span>投产固定矩阵版本</span><small>未签字随版本重算 · 已签字冻结</small></div>
      </aside>
      <main>
        <TerminalStrip />
        <ConflictBand />
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/process" element={<ProcessControl />} />
          <Route path="/deviations" element={<DeviationWorkbench />} />
          <Route path="/audit" element={<AuditTrail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Button className="reset-button" appearance="subtle" onClick={() => { dispatch(resetDemo()); dispatch(resetTerminal()) }}>恢复演示数据</Button>
      </main>
    </div>
  )
}

export function App() {
  return <BrowserRouter><Shell /></BrowserRouter>
}
