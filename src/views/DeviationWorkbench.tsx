import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Field, Input, Option, Textarea } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { createDeviation, reviewDeviation, saveInvestigation } from '../store/haccpSlice'
import { evaluateBasis, matrixById, matrixLabel } from '../services/basis'
import type { DecisionType, Deviation, Investigation } from '../types'

export function DeviationWorkbench() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const [status, setStatus] = useState<Deviation['status'] | '全部'>('全部')
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const [newDeviation, setNewDeviation] = useState({ batchId: state.batches[0]?.id ?? '', stepId: '', title: '', severity: '一般' as const, owner: '质量工程组' })
  const rows = useMemo(() => state.deviations.filter((item) => status === '全部' || item.status === status), [state.deviations, status])
  const selected = state.deviations.find((item) => item.id === selectedId) ?? rows[0]
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const activeInvestigation = investigation?.cause === selected?.investigation.cause ? investigation : selected?.investigation

  const selectedBatch = state.batches.find((item) => item.id === selected?.batchId)
  const createBatch = state.batches.find((item) => item.id === newDeviation.batchId)
  const createMatrix = createBatch ? matrixById(state.matrices, createBatch.matrixVersionId) : state.matrices[state.matrices.length - 1]

  return (
    <section className="page">
      <header className="page-head"><div><p>关键限值偏离 / 调查与复核</p><h1>偏差处置工作台</h1></div><Button appearance="primary" onClick={() => { setNewDeviation((d) => ({ ...d, stepId: createMatrix.steps[0].id })); setShowCreate(true) }}>登记偏差</Button></header>
      <div className="toolbar"><Dropdown value={status} selectedOptions={[status]} onOptionSelect={(_, data) => setStatus(data.optionValue as typeof status)}>{['全部', '待调查', '待复核', '调查中', '已关闭'].map((item) => <Option key={item} value={item}>{item}</Option>)}</Dropdown><span>关闭偏差不等于可放行：还需同一控制点后续合格读数确认；超限补录只开新偏差，不会重新挑起已关闭偏差。</span></div>
      <div className="split-layout">
        <div className="deviation-list">{rows.map((item) => {
          const batch = state.batches.find((b) => b.id === item.batchId)
          const ev = batch ? evaluateBasis(batch, state.deviations, state.matrices) : null
          const confirmed = item.status === '已关闭' && ev?.confirmations[item.id]
          return <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setInvestigation(null) }}>
            <div><Badge color={item.severity === '重大' ? 'danger' : 'warning'}>{item.severity}</Badge><small>{item.id}</small></div>
            <strong>{item.title}</strong>
            <span>{item.batchId} · {item.owner}</span>
            <footer>
              <Badge appearance="tint" color={item.status === '已关闭' ? (confirmed ? 'success' : 'warning') : 'danger'}>
                {item.status}{item.status === '已关闭' ? (confirmed ? ' · 已确认' : ' · 待确认') : ''}
              </Badge>
              <span>{item.dueDate} 截止</span>
            </footer>
          </button>
        })}</div>
        {selected && selectedBatch && (() => {
          const batchEvaluation = evaluateBasis(selectedBatch, state.deviations, state.matrices)
          const matrix = matrixById(state.matrices, selected.basisMatrixId)
          const confirmed = batchEvaluation.confirmations[selected.id]
          const confirmation = selectedBatch.monitoring.find((item) => item.id === selected.confirmationReadingId)
          return <div className="record-panel">
            <div className="record-title"><div><span>{selected.id} · V{selected.version}</span><h2>{selected.title}</h2></div><Badge color={selected.severity === '重大' ? 'danger' : 'warning'}>{selected.status}</Badge></div>
            <div className="basis-card">
              <div><span>偏差依据（开偏差时固定）</span><strong>{matrixLabel(matrix)}</strong></div>
              <small>关键限值：{selected.basisLimit}{selected.autoOpened ? ` · 由超限读数自动开出` : ' · 人工登记'}</small>
              {selected.status === '已关闭' && <small className={confirmed ? 'confirmed' : 'recalc'}>{confirmed
                ? `已由后续合格读数 ${confirmation?.value}${confirmation?.unit}（${confirmation?.recordedAt.replace('T', ' ').slice(0, 16)}，${confirmation?.source}）确认，可恢复放行判定`
                : '偏差已关闭，仍在等待同一控制点、关闭时间之后的合格读数确认'}</small>}
            </div>
            <Field label="原因判断"><Textarea value={activeInvestigation?.cause ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), cause: data.value })} /></Field>
            <Field label="证据摘要"><Textarea value={activeInvestigation?.evidence ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), evidence: data.value })} /></Field>
            <Field label="处置分支"><Dropdown value={activeInvestigation?.decision} selectedOptions={[activeInvestigation?.decision ?? '返工']} onOptionSelect={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), decision: data.optionValue as DecisionType })}>{['返工', '报废', '让步接收'].map((item) => <Option key={item} value={item} text={item}>{item}</Option>)}</Dropdown></Field>
            <Field label="返工或报废指令"><Textarea value={activeInvestigation?.reworkInstruction ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), reworkInstruction: data.value })} /></Field>
            <div className="record-actions">
              <Button disabled={!activeInvestigation?.cause || !activeInvestigation?.evidence} onClick={() => dispatch(saveInvestigation({ id: selected.id, investigation: activeInvestigation! }))}>提交调查</Button>
              <Button appearance="primary" disabled={selected.status !== '待复核'} onClick={() => dispatch(reviewDeviation({ id: selected.id, approved: true, note: '调查证据充分，纠偏措施可执行。', reviewer: '质量负责人 秦岚' }))}>复核通过（关闭）</Button>
            </div>
            <Button appearance="subtle" disabled={selected.status !== '待复核'} onClick={() => dispatch(reviewDeviation({ id: selected.id, approved: false, note: '需补充设备故障诊断记录。', reviewer: '质量负责人 秦岚' }))}>退回补充证据</Button>
            {selected.status === '已关闭' && !confirmed && <p className="validation-text">注意：关闭后需在批次监测中补入或等待 {matrix.steps.find((s) => s.id === selected.stepId)?.controlPoint} 的后续合格读数（按 {matrixLabel(matrix)} 判定），放行结论才会解除冻结。</p>}
          </div>
        })()}
      </div>
      {showCreate && <div className="edit-panel">
        <h3>登记关键限值偏差</h3>
        <div className="edit-grid">
          <Field label="批次（按批次固定矩阵开偏差）"><Dropdown value={newDeviation.batchId} selectedOptions={[newDeviation.batchId]} onOptionSelect={(_, data) => {
            const batchId = data.optionValue ?? ''
            const matrix = state.matrices.find((m) => m.id === state.batches.find((b) => b.id === batchId)?.matrixVersionId)
            setNewDeviation({ ...newDeviation, batchId, stepId: matrix?.steps[0].id ?? '' })
          }}>{state.batches.filter((b) => !b.release).map((item) => <Option key={item.id} value={item.id} text={`${item.id} ${item.product}`}>{item.id} {item.product}</Option>)}</Dropdown></Field>
          <Field label={`控制点（${matrixLabel(createMatrix)}）`}><Dropdown value={newDeviation.stepId} selectedOptions={[newDeviation.stepId]} onOptionSelect={(_, data) => setNewDeviation({ ...newDeviation, stepId: data.optionValue ?? '' })}>{createMatrix.steps.map((item) => <Option key={item.id} value={item.id} text={item.name}>{item.name}（{item.limit}）</Option>)}</Dropdown></Field>
          <Field label="偏差标题"><Input value={newDeviation.title} onChange={(_, data) => setNewDeviation({ ...newDeviation, title: data.value })} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setShowCreate(false)}>取消</Button><Button appearance="primary" disabled={!newDeviation.title || !newDeviation.batchId || !newDeviation.stepId} onClick={() => { dispatch(createDeviation(newDeviation)); setShowCreate(false) }}>创建并冻结批次放行</Button></div>
      </div>}
    </section>
  )
}
