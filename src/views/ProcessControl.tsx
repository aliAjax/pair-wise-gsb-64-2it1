import { useState } from 'react'
import { Badge, Button, Field, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { updateProcessStep } from '../store/haccpSlice'
import type { ProcessStep } from '../types'

export function ProcessControl() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const steps = state.processSteps
  const current = state.matrixVersions.find((item) => item.id === state.currentMatrixVersionId)
  const [editing, setEditing] = useState<ProcessStep | null>(null)
  const save = () => { if (editing) dispatch(updateProcessStep(editing)); setEditing(null) }
  const pinnedBy = (versionId: string) => state.batches.filter((batch) => (batch.signedMatrixVersionId ?? batch.matrixVersionId) === versionId).map((batch) => batch.id)

  return (
    <section className="page">
      <header className="page-head"><div><p>危害分析 / 关键控制点</p><h1>HACCP控制矩阵</h1></div><span className="sync-state">当前生效 {state.currentMatrixVersionId}{current ? ` · ${current.publishedAt.slice(0, 16).replace('T', ' ')}发布` : ''}</span></header>
      <div className="process-flow">{steps.map((step, index) => <div key={step.id}><b>{index + 1}</b><span>{step.name}</span><small>{step.equipment}</small></div>)}</div>
      <div className="table-panel">
        <Table size="small">
          <TableHeader><TableRow><TableHeaderCell>步骤</TableHeaderCell><TableHeaderCell>潜在危害</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>关键限值</TableHeaderCell><TableHeaderCell>监控频率</TableHeaderCell><TableHeaderCell /></TableRow></TableHeader>
          <TableBody>{steps.map((step) => <TableRow key={step.id}><TableCell>{step.name}</TableCell><TableCell>{step.hazard}</TableCell><TableCell>{step.controlPoint}</TableCell><TableCell><strong>{step.limit}</strong></TableCell><TableCell>{step.frequency}</TableCell><TableCell><Button size="small" appearance="subtle" onClick={() => setEditing(structuredClone(step))}>编辑</Button></TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      {editing && <div className="edit-panel">
        <h3>{editing.name} · 控制参数</h3>
        <div className="edit-grid">
          <Field label="关键限值"><Input value={editing.limit} onChange={(_, data) => setEditing({ ...editing, limit: data.value })} /></Field>
          <Field label="监控频率"><Input value={editing.frequency} onChange={(_, data) => setEditing({ ...editing, frequency: data.value })} /></Field>
          <Field label="纠偏措施"><Input value={editing.correctiveAction} onChange={(_, data) => setEditing({ ...editing, correctiveAction: data.value })} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setEditing(null)}>取消</Button><Button appearance="primary" disabled={!editing.limit || !editing.correctiveAction} onClick={save}>发布新版本并审计</Button></div>
      </div>}
      <div className="table-panel version-panel">
        <h3>矩阵版本与生效依据</h3>
        <Table size="small">
          <TableHeader><TableRow><TableHeaderCell>版本</TableHeaderCell><TableHeaderCell>发布时间</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell><TableHeaderCell>引用批次</TableHeaderCell></TableRow></TableHeader>
          <TableBody>{[...state.matrixVersions].reverse().map((version) => <TableRow key={version.id}>
            <TableCell>{version.id}{version.id === state.currentMatrixVersionId && <Badge appearance="tint" color="success">当前</Badge>}</TableCell>
            <TableCell>{version.publishedAt.slice(0, 16).replace('T', ' ')} · {version.publishedBy}</TableCell>
            <TableCell>{version.note}</TableCell>
            <TableCell>{pinnedBy(version.id).join('、') || '—'}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="rule-band"><strong>控制矩阵约束</strong><span>每次修改发布为新版本；批次投产时固定所依据版本，已签字批次继续按签字依据展示，未签字批次的放行结论立即按各自依据重算。</span></div>
    </section>
  )
}
