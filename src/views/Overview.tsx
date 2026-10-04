import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Badge, Button, Dropdown, Input, Option, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { dismissReleaseConflict, setBatchFilter, setBatchStatus, setSelectedBatch, signRelease, updateBatchStatus } from '../store/haccpSlice'
import { effectiveMatrixVersionId, evaluateLimit, isTerminal, stepsOfVersion } from '../services/conclusion'
import type { Batch, BatchStatus, ConclusionOutcome } from '../types'
import { useLoadBatchSnapshotQuery } from '../services/api'
import { MonitoringEntry } from './MonitoringEntry'

const statuses: Array<BatchStatus | '全部'> = ['全部', '待投产', '生产中', '待复核', '可放行', '隔离中', '已放行', '已报废']
const statusColor = (status: BatchStatus) => status === '隔离中' || status === '已报废' ? 'danger' : status === '已放行' ? 'success' : status === '可放行' ? 'important' : 'warning'
const outcomeColor = (outcome: ConclusionOutcome) => outcome === '符合放行' ? 'success' : outcome === '待确认' || outcome === '待补录' ? 'warning' : 'danger'
const isBackfilled = (recordedAt: string, submittedAt: string) => new Date(submittedAt).getTime() - new Date(recordedAt).getTime() > 30 * 60 * 1000

export function Overview() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const { isFetching } = useLoadBatchSnapshotQuery()
  const rows = useMemo(() => state.batches.filter((batch) => {
    const text = `${batch.id} ${batch.product} ${batch.line}`.toLowerCase()
    return (!state.batchFilter || text.includes(state.batchFilter.toLowerCase())) && (state.batchStatus === '全部' || batch.status === state.batchStatus)
  }), [state.batches, state.batchFilter, state.batchStatus])
  const selected = state.batches.find((item) => item.id === state.selectedBatchId) ?? rows[0]
  const selectedDeviations = state.deviations.filter((item) => item.batchId === selected?.id)
  const basisVersionId = selected
    ? isTerminal(selected)
      ? selected.signedMatrixVersionId ?? effectiveMatrixVersionId(selected, state.currentMatrixVersionId)
      : effectiveMatrixVersionId(selected, state.currentMatrixVersionId)
    : state.currentMatrixVersionId
  const basisVersion = state.matrixVersions.find((item) => item.id === basisVersionId)
  const basisSteps = stepsOfVersion(state.matrixVersions, basisVersionId, state.processSteps)
  const conflict = selected ? state.releaseConflicts[selected.id] : undefined

  return (
    <section className="page">
      <header className="page-head"><div><p>质量运营中心 / 批次控制</p><h1>生产批次与放行</h1></div><span className="sync-state">{isFetching ? '正在同步' : '批次快照已加载'}</span></header>
      <div className="metrics">
        <article><span>今日批次</span><strong>{state.batches.length}</strong><small>覆盖2条生产线</small></article>
        <article><span>隔离批次</span><strong>{state.batches.filter((item) => item.status === '隔离中').length}</strong><small>禁止放行</small></article>
        <article><span>未关闭偏差</span><strong>{state.deviations.filter((item) => item.status !== '已关闭').length}</strong><small>需调查或复核</small></article>
        <article><span>已放行</span><strong>{state.batches.filter((item) => item.status === '已放行').length}</strong><small>已完成签字</small></article>
      </div>
      <div className="toolbar">
        <Input value={state.batchFilter} onChange={(_, data) => dispatch(setBatchFilter(data.value))} placeholder="搜索批次、产品、产线" />
        <Dropdown value={state.batchStatus} selectedOptions={[state.batchStatus]} onOptionSelect={(_, data) => dispatch(setBatchStatus(data.optionValue as BatchStatus | '全部'))}>
          {statuses.map((status) => <Option key={status} value={status}>{status}</Option>)}
        </Dropdown>
        <span>点击批次查看监测点、生效依据与放行结论</span>
      </div>
      <div className="split-layout">
        <div className="table-panel">
          <Table size="small" aria-label="生产批次">
            <TableHeader><TableRow><TableHeaderCell>批次</TableHeaderCell><TableHeaderCell>产品</TableHeaderCell><TableHeaderCell>产线</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>依据</TableHeaderCell><TableHeaderCell>版本</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {rows.map((batch) => <TableRow key={batch.id} onClick={() => dispatch(setSelectedBatch(batch.id))} className={batch.id === selected?.id ? 'selected-row' : ''}>
                <TableCell>{batch.id}</TableCell><TableCell>{batch.product}</TableCell><TableCell>{batch.line}</TableCell>
                <TableCell><Badge appearance="tint" color={statusColor(batch.status)}>{batch.status}</Badge></TableCell>
                <TableCell>{batch.signedMatrixVersionId ?? batch.matrixVersionId ?? state.currentMatrixVersionId}</TableCell><TableCell>V{batch.version}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </div>
        {selected && <aside className="record-panel">
          <div className="record-title"><div><span>{selected.id} · {selected.line}</span><h2>{selected.product}</h2></div><Badge color={statusColor(selected.status)}>{selected.status}</Badge></div>
          <dl>
            <div><dt>生产数量</dt><dd>{selected.quantity.toLocaleString()} 件</dd></div>
            <div><dt>隔离范围</dt><dd>{selected.isolationScope}</dd></div>
            <div><dt>生效依据</dt><dd>{basisVersionId}{basisVersion ? `（${basisVersion.publishedAt.slice(0, 10)}发布）` : ''}{selected.matrixVersionId ? ' · 投产固定' : ' · 跟随当前矩阵'}</dd></div>
            <div><dt>关联偏差</dt><dd>{selectedDeviations.length} 项</dd></div>
            {selected.signedAt && <div><dt>签字</dt><dd>{selected.signedBy} · {selected.signedAt.slice(0, 16).replace('T', ' ')}</dd></div>}
          </dl>
          {selected.conclusion && <div className={`conclusion-card outcome-${selected.conclusion.outcome}`}>
            <div><Badge appearance="filled" color={outcomeColor(selected.conclusion.outcome)}>{selected.conclusion.outcome}</Badge><small>依据{selected.conclusion.matrixVersionId} · {selected.conclusion.computedAt.slice(0, 16).replace('T', ' ')}重算</small></div>
            <ul>{selected.conclusion.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>}
          <h3>监测点结果</h3>
          <div className="monitoring-list">{selected.monitoring.map((item) => {
            const step = basisSteps.find((entry) => entry.id === item.stepId)
            const pass = step ? evaluateLimit(step.limit, item.value) : true
            return <div key={`${selected.id}-${item.submissionId}`}><span>{step?.controlPoint ?? item.stepId}<small className="limit-text">限值 {step?.limit ?? '-'}</small></span><strong>{item.value} {item.unit}</strong><small>{item.operator} · {item.recordedAt.slice(11, 16)}　<Badge size="small" appearance="tint" color={pass ? 'success' : 'danger'}>{pass ? '合格' : '超限'}</Badge>{isBackfilled(item.recordedAt, item.submittedAt) && <Badge size="small" appearance="outline" color="warning">补录</Badge>}</small></div>
          })}</div>
          {!isTerminal(selected) && selected.status !== '待投产' && <MonitoringEntry key={selected.id} batch={selected} steps={basisSteps} />}
          {conflict && <div className="conflict-banner">
            <strong>提交冲突：另一终端已先行提交</strong>
            <span>您基于版本V{conflict.baseVersion}的结论未生效，当前版本V{conflict.currentVersion}。填值已保留，请核对最新监测与结论后重新提交。</span>
            <div className="record-actions">
              <Button size="small" onClick={() => dispatch(dismissReleaseConflict({ batchId: selected.id }))}>放弃本次填值</Button>
              <Button size="small" appearance="primary" onClick={() => dispatch(signRelease({ batchId: selected.id, expectedVersion: selected.version, signer: conflict.signer, note: conflict.note }))}>按当前版本重新提交</Button>
            </div>
          </div>}
          <SignPanel batch={selected} hasConflict={!!conflict} />
          <div className="record-actions">
            {selected.status === '待投产' && <Button appearance="primary" onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '生产中' }))}>投产并固定当前矩阵</Button>}
            {!isTerminal(selected) && selected.status !== '待投产' && <Button appearance="secondary" disabled={selected.conclusion?.outcome !== '符合放行' || selected.status === '可放行'} onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '可放行' }))}>提交放行复核</Button>}
          </div>
          {selected.conclusion && selected.conclusion.outcome !== '符合放行' && !isTerminal(selected) && selected.status !== '待投产' && <p className="validation-text">放行结论为「{selected.conclusion.outcome}」，系统已阻止提交放行复核。</p>}
        </aside>}
      </div>
    </section>
  )
}

/** 签字放行：提交时携带所见批次版本，先到者生效；版本过期则保留填值并提示冲突 */
function SignPanel({ batch, hasConflict }: { batch: Batch; hasConflict: boolean }) {
  const dispatch = useDispatch<AppDispatch>()
  const [signer, setSigner] = useState('')
  const [note, setNote] = useState('')
  const [baseVersion, setBaseVersion] = useState(batch.version)

  useEffect(() => {
    setSigner('')
    setNote('')
    setBaseVersion(batch.version)
  }, [batch.id])
  useEffect(() => {
    if (!signer && !note && !hasConflict) setBaseVersion(batch.version)
  }, [batch.version, signer, note, hasConflict])
  useEffect(() => {
    if (batch.status === '已放行') { setSigner(''); setNote('') }
  }, [batch.status])

  if (batch.status !== '可放行') return null
  return <div className="sign-panel">
    <h3>签字放行（提交批次结论）</h3>
    <div className="sign-grid">
      <Input placeholder="签字人，如：质量负责人 秦岚" value={signer} onChange={(_, data) => setSigner(data.value)} />
      <Input placeholder="放行备注（可选）" value={note} onChange={(_, data) => setNote(data.value)} />
    </div>
    <div className="record-actions">
      <span className="sync-state">基于批次版本V{baseVersion}提交</span>
      <Button appearance="primary" disabled={!signer.trim() || hasConflict} onClick={() => dispatch(signRelease({ batchId: batch.id, expectedVersion: baseVersion, signer, note }))}>签字放行</Button>
    </div>
  </div>
}
