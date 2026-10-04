import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Badge, Button } from '@fluentui/react-components'
import { BrowserRouter } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { onPersistChange, type AppDispatch, type RootState } from './store'
import { resetDemo } from './store/haccpSlice'
import { readPersistError } from './services/drafts'
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

function PersistBanner() {
  const [failed, setFailed] = useState(() => !!readPersistError())
  useEffect(() => onPersistChange(setFailed), [])
  if (!failed) return null
  return <div className="persist-banner">本地写入失败：当前数据仅保留在内存中，未完成的监测点已存为草稿，写入恢复后将自动重放，重复补传不会重复开偏差。</div>
}

function Shell() {
  const dispatch = useDispatch<AppDispatch>()
  const openDeviations = useSelector((state: RootState) => state.haccp.deviations.filter((item) => item.status !== '已关闭').length)
  const currentMatrixVersionId = useSelector((state: RootState) => state.haccp.currentMatrixVersionId)
  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><b>H</b><div><strong>食品安全控制台</strong><small>HACCP批次与偏差溯源</small></div></div>
        <nav>{navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}><span>{label}</span>{label === '偏差调查' && <Badge appearance="filled" color="danger">{openDeviations}</Badge>}</NavLink>)}</nav>
        <div className="aside-note"><strong>当前生效矩阵</strong><span>{currentMatrixVersionId}</span><small>生产日 2026-10-04 · 数据源：本地持久化</small></div>
      </aside>
      <main>
        <PersistBanner />
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/process" element={<ProcessControl />} />
          <Route path="/deviations" element={<DeviationWorkbench />} />
          <Route path="/audit" element={<AuditTrail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Button className="reset-button" appearance="subtle" onClick={() => dispatch(resetDemo())}>恢复演示数据</Button>
      </main>
    </div>
  )
}

export function App() {
  return <BrowserRouter><Shell /></BrowserRouter>
}
