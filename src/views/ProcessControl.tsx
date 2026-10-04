import { useMemo, useState } from 'react'
import { Badge, Button, Field, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Textarea } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { publishMatrix } from '../store/haccpSlice'
import { matrixLabel } from '../services/basis'
import type { ProcessStep } from '../types'

function localInput(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ProcessControl() {
  const dispatch = useDispatch<AppDispatch>()
  const matrices = useSelector((root: RootState) => root.haccp.matrices)
  const batches = useSelector((root: RootState) => root.haccp.batches)
  const [selectedId, setSelectedId] = useState(matrices[matrices.length - 1].id)
  const [editing, setEditing] = useState<ProcessStep[] | null>(null)
  const [effectiveAt, setEffectiveAt] = useState(localInput())
  const [note, setNote] = useState('')

  const ordered = useMemo(() => [...matrices].sort((a, b) => b.version - a.version), [matrices])
  const matrix = matrices.find((item) => item.id === selectedId) ?? matrices[matrices.length - 1]
  const pinnedCount = batches.filter((item) => item.matrixVersionId === matrix.id).length
  const signedCount = batches.filter((item) => item.matrixVersionId === matrix.id && item.release).length

  const startDraft = () => {
    setEditing(structuredClone(matrix.steps))
    const next = new Date(Date.now() + 3600000)
    setEffectiveAt(localInput(next))
    setNote('')
  }

  const save = () => {
    if (!editing) return
    const iso = effectiveAt.replace(' ', 'T').length === 16 ? `${effectiveAt.replace(' ', 'T')}:00` : effectiveAt
    dispatch(publishMatrix({ steps: editing, effectiveAt: iso, note: note || '控制矩阵例行更新', publishedBy: '质量主管（本机终端）' }))
    setEditing(null)
  }

  const updateStep = (id: string, patch: Partial<ProcessStep>) => {
    setEditing((steps) => steps?.map((step) => (step.id === id ? { ...step, ...patch } : step)) ?? null)
  }

  return (
    <section className="page">
      <header className="page-head"><div><p>危害分析 / 关键控制点</p><h1>HACCP控制矩阵（生效依据）</h1></div>
        {!editing && <Button appearance="primary" onClick={startDraft}>基于当前版本改版</Button>}
      </header>

      <div className="version-tabs">
        {ordered.map((item) => (
          <button key={item.id} className={item.id === selectedId && !editing ? 'active' : ''} onClick={() => { setSelectedId(item.id); setEditing(null) }}>
            <strong>V{item.version}</strong>
            <span>{item.effectiveAt.slice(0, 10)} 生效</span>
            <small>{batches.filter((b) => b.matrixVersionId === item.id).length} 个批次固定此版</small>
          </button>
        ))}
        {editing && <button className="draft"><strong>新版草稿</strong><span>待发布</span><small>基于 V{matrix.version} 修订</small></button>}
      </div>

      {!editing && <div className="table-panel">
        <div className="matrix-meta">
          <Badge appearance="outline" color="brand">{matrix.id}</Badge>
          <span>发布人：{matrix.publishedBy}</span>
          <span>发布时间：{matrix.publishedAt.replace('T', ' ').slice(0, 16)}</span>
          <span>生效时间：{matrix.effectiveAt.replace('T', ' ').slice(0, 16)}</span>
          <span>{pinnedCount} 个批次固定本版（其中 {signedCount} 个已签字冻结）</span>
        </div>
        <p className="basis-note">改版说明：{matrix.note}</p>
        <Table size="small">
          <TableHeader><TableRow><TableHeaderCell>步骤</TableHeaderCell><TableHeaderCell>潜在危害</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>关键限值</TableHeaderCell><TableHeaderCell>监控频率</TableHeaderCell><TableHeaderCell>纠偏措施</TableHeaderCell></TableRow></TableHeader>
          <TableBody>{matrix.steps.map((step) => <TableRow key={step.id}>
            <TableCell>{step.name}<small className="equip">{step.equipment}</small></TableCell>
            <TableCell>{step.hazard}</TableCell>
            <TableCell>{step.controlPoint}</TableCell>
            <TableCell><strong>{step.limit}</strong></TableCell>
            <TableCell>{step.frequency}</TableCell>
            <TableCell>{step.correctiveAction}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>}

      {editing && <div className="edit-panel">
        <h3>新版控制矩阵草稿（V{matrix.version} → V{matrix.version + 1}）</h3>
        <div className="edit-grid">
          <Field label="生效时间（投产于此后的批次固定新版）"><Input value={effectiveAt} onChange={(_, data) => setEffectiveAt(data.value)} placeholder="YYYY-MM-DD HH:mm" /></Field>
          <Field label="改版说明" style={{ gridColumn: 'span 2' }}><Input value={note} onChange={(_, data) => setNote(data.value)} placeholder="例如：杀菌温度下限收紧" /></Field>
        </div>
        <Table size="small" className="draft-table">
          <TableHeader><TableRow><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>关键限值（文本）</TableHeaderCell><TableHeaderCell>数值下限</TableHeaderCell><TableHeaderCell>数值上限</TableHeaderCell><TableHeaderCell>单位</TableHeaderCell><TableHeaderCell>纠偏措施</TableHeaderCell></TableRow></TableHeader>
          <TableBody>{editing.map((step) => <TableRow key={step.id}>
            <TableCell>{step.controlPoint}</TableCell>
            <TableCell><Input value={step.limit} onChange={(_, data) => updateStep(step.id, { limit: data.value })} size="small" /></TableCell>
            <TableCell><Input type="number" value={String(step.spec.min ?? '')} onChange={(_, data) => updateStep(step.id, { spec: { ...step.spec, min: data.value === '' ? null : Number(data.value) } })} size="small" /></TableCell>
            <TableCell><Input type="number" value={String(step.spec.max ?? '')} onChange={(_, data) => updateStep(step.id, { spec: { ...step.spec, max: data.value === '' ? null : Number(data.value) } })} size="small" /></TableCell>
            <TableCell><Input value={step.spec.unit} onChange={(_, data) => updateStep(step.id, { spec: { ...step.spec, unit: data.value } })} size="small" /></TableCell>
            <TableCell><Input value={step.correctiveAction} onChange={(_, data) => updateStep(step.id, { correctiveAction: data.value })} size="small" /></TableCell>
          </TableRow>)}</TableBody>
        </Table>
        <p className="basis-note"><b>生效规则：</b>已投产批次在投产时刻固定矩阵版本，本次改版不改变其判定；发布后未签字批次立即按各自固定版本重算结论；已签字批次继续按原依据冻结展示。</p>
        <div className="record-actions"><Button onClick={() => setEditing(null)}>取消</Button><Button appearance="primary" disabled={!note.trim() || !effectiveAt.trim()} onClick={save}>发布新版并触发重算</Button></div>
      </div>}

      <div className="rule-band"><strong>控制矩阵约束</strong><span>矩阵按版本发布并带生效时间；批次投产即固定版本（{matrixLabel(matrix)}）。批次监测、偏差处置、放行结论共用此唯一生效依据。</span></div>
    </section>
  )
}
