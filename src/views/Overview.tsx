import { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Badge, Button, Dropdown, Field, Input, Option, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { createBatch, setBatchFilter, setBatchStatus, setSelectedBatch } from '../store/haccpSlice'
import { flushOutbox, submitConclusion, submitReading } from '../store/terminalSlice'
import { evaluateBasis, matrixLabel } from '../services/basis'
import type { BatchStatus, MonitoringSource } from '../types'

const statuses: Array<BatchStatus | '全部'> = ['全部', '生产中', '待复核', '可放行', '隔离中', '已放行', '已报废']
const statusColor = (status: BatchStatus) => status === '隔离中' || status === '已报废' ? 'danger' : status === '已放行' ? 'success' : status === '可放行' ? 'important' : 'warning'

function nowInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Overview() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const terminal = useSelector((root: RootState) => root.terminal)
  const [readingForm, setReadingForm] = useState({ stepId: '', value: '', recordedAt: nowInput(), source: '人工录入' as MonitoringSource })
  const [readingMessage, setReadingMessage] = useState<{ kind: 'ok' | 'warn' | 'offline'; text: string } | null>(null)
  const [note, setNote] = useState('')
  const [signer, setSigner] = useState('质量负责人 秦岚')
  const [submitMessage, setSubmitMessage] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [showNewBatch, setShowNewBatch] = useState(false)
  const [newBatch, setNewBatch] = useState({ product: '低温鲜奶 950mL', line: 'L1', quantity: 3000 })

  const rows = useMemo(() => state.batches.filter((batch) => {
    const text = `${batch.id} ${batch.product} ${batch.line}`.toLowerCase()
    return (!state.batchFilter || text.includes(state.batchFilter.toLowerCase())) && (state.batchStatus === '全部' || batch.status === state.batchStatus)
  }), [state.batches, state.batchFilter, state.batchStatus])
  const selected = state.batches.find((item) => item.id === state.selectedBatchId) ?? rows[0]

  const evaluation = useMemo(
    () => selected ? evaluateBasis(selected, state.deviations, state.matrices) : null,
    [selected, state.deviations, state.matrices]
  )
  const selectedDeviations = state.deviations.filter((item) => item.batchId === selected?.id)
  const draft = selected ? terminal.drafts[selected.id] : undefined

  const sendReading = () => {
    if (!selected || !readingForm.stepId || readingForm.value === '') return
    const step = evaluation?.matrix.steps.find((item) => item.id === readingForm.stepId)
    const result = dispatch(submitReading({
      batchId: selected.id, stepId: readingForm.stepId, value: Number(readingForm.value),
      unit: step?.spec.unit ?? '', recordedAt: readingForm.recordedAt,
      operator: terminal.terminalName, source: readingForm.source
    }))
    if (result.offline) {
      setReadingMessage({ kind: 'offline', text: `本地写入失败，已挂起未完成监测点（${step?.controlPoint}）；恢复网络后可一键幂等补传。` })
    } else if (result.duplicate) {
      setReadingMessage({ kind: 'warn', text: '该读数已补传过（clientId 命中），本次为重复提交：未重复落库，也未重复开偏差。' })
    } else if (result.openedDeviationId) {
      setReadingMessage({ kind: 'warn', text: `读数超出${matrixLabel(evaluation!.matrix)}关键限值，已自动开出偏差 ${result.openedDeviationId} 并冻结放行。` })
    } else {
      setReadingMessage({ kind: 'ok', text: `读数已按 ${matrixLabel(evaluation!.matrix)} 判定合格并落库。` })
    }
    setReadingForm((form) => ({ ...form, value: '' }))
  }

  const doSubmit = (action: '提交复核' | '签字放行') => {
    if (!selected) return
    const result = dispatch(submitConclusion({ batchId: selected.id, action, note: note || (action === '提交复核' ? '申请放行复核' : '关键控制点全部合格，同意放行'), signer, baseSeq: draft?.baseSeq }))
    if (result.outcome === 'committed') {
      setSubmitMessage({ kind: 'ok', text: `${action}已生效（结论版本 V${result.seq}）。` })
      setNote('')
    } else if (result.outcome === 'conflict') {
      setSubmitMessage({
        kind: 'warn',
        text: `提交冲突：${result.otherTerminalName} 已先于您完成「${result.otherAction}」（版本 V${result.currentSeq}）。先到者生效，您的签字人与备注填值已保留，可查看最新结论后决定是否重新提交。`
      })
    } else if (result.outcome === 'blocked') {
      setSubmitMessage({ kind: 'error', text: `放行被冻结：${result.reasons.join('；')}` })
    } else {
      setSubmitMessage({ kind: 'warn', text: '该批次已签字，结论与依据已冻结，不能再次提交。' })
    }
  }

  const recover = () => {
    const report = dispatch(flushOutbox())
    const reopened = report.filter((item) => item.openedDeviationId)
    const duplicates = report.filter((item) => item.duplicate)
    setReadingMessage({
      kind: reopened.length ? 'warn' : 'ok',
      text: `本地写入已恢复，${report.length} 个未完成监测点全部补传完成${duplicates.length ? `；其中 ${duplicates.length} 条此前已落库，按幂等去重` : ''}${reopened.length ? `；超限读数已开偏差 ${reopened.map((item) => item.openedDeviationId).join('、')}` : ''}。`
    })
  }

  return (
    <section className="page">
      <header className="page-head"><div><p>质量运营中心 / 批次控制</p><h1>生产批次与放行</h1></div>
        <Button appearance="primary" onClick={() => setShowNewBatch(true)}>新批次投产</Button></header>
      <div className="metrics">
        <article><span>今日批次</span><strong>{state.batches.length}</strong><small>投产即固定矩阵版本</small></article>
        <article><span>隔离批次</span><strong>{state.batches.filter((item) => item.status === '隔离中').length}</strong><small>超限/偏差冻结放行</small></article>
        <article><span>未关闭偏差</span><strong>{state.deviations.filter((item) => item.status !== '已关闭').length}</strong><small>含待合格确认</small></article>
        <article><span>已放行</span><strong>{state.batches.filter((item) => item.status === '已放行').length}</strong><small>结论与依据已冻结</small></article>
      </div>

      {terminal.outbox.length > 0 && (
        <div className="offline-band">
          <div><strong>本地写入失败：{terminal.outbox.length} 个监测点未完成</strong>
            <span>{terminal.outbox.map((item) => `${item.batchId}/${item.stepId} ${item.value}${item.unit}`).join('；')}</span></div>
          <Button appearance="primary" size="small" onClick={recover}>网络已恢复，补传未完成监测点</Button>
        </div>
      )}

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
            <TableHeader><TableRow><TableHeaderCell>批次</TableHeaderCell><TableHeaderCell>产品</TableHeaderCell><TableHeaderCell>依据版本</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>结论版本</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {rows.map((batch) => {
                const mx = state.matrices.find((item) => item.id === batch.matrixVersionId)
                return <TableRow key={batch.id} onClick={() => { dispatch(setSelectedBatch(batch.id)); setSubmitMessage(null) }} className={batch.id === selected?.id ? 'selected-row' : ''}>
                  <TableCell>{batch.id}</TableCell><TableCell>{batch.product}<small className="equip">{batch.line}</small></TableCell>
                  <TableCell><Badge appearance="outline" color={batch.release ? 'success' : 'brand'}>V{mx?.version}</Badge></TableCell>
                  <TableCell><Badge appearance="tint" color={statusColor(batch.status)}>{batch.status}</Badge></TableCell>
                  <TableCell>V{batch.conclusionSeq}{batch.release ? ' · 已冻结' : ''}</TableCell>
                </TableRow>
              })}
            </TableBody>
          </Table>
        </div>
        {selected && evaluation && <aside className="record-panel">
          <div className="record-title"><div><span>{selected.id} · {selected.line}</span><h2>{selected.product}</h2></div><Badge color={statusColor(selected.status)}>{selected.status}</Badge></div>

          <div className="basis-card">
            <div><span>批次生效依据（投产时固定）</span><strong>{matrixLabel(evaluation.matrix)}</strong></div>
            <small>{evaluation.matrix.id} · {selected.producedAt.replace('T', ' ').slice(0, 16)} 投产</small>
            {selected.recalculatedAt && !selected.release && <small className="recalc">矩阵更新后结论已于 {selected.recalculatedAt.replace('T', ' ').slice(0, 16)} 按本版本重算</small>}
            {selected.release && <small className="frozen">已签字：继续按 {selected.release.matrixLabel} 原依据冻结展示，矩阵改版不重算</small>}
          </div>

          {selected.release ? (
            <>
              <h3>签字放行结论（冻结）</h3>
              <ConclusionTable lines={selected.release.lines} />
              <dl><div><dt>签字人</dt><dd>{selected.release.signer}</dd></div><div><dt>签字终端</dt><dd>{selected.release.terminalName}</dd></div><div><dt>签字时间</dt><dd>{selected.release.signedAt.replace('T', ' ').slice(0, 16)}</dd></div></dl>
              <p className="basis-note">{selected.release.note}</p>
            </>
          ) : (
            <>
              <h3>放行结论（按固定版本实时判定）</h3>
              <ConclusionTable lines={evaluation.lines} />
              {evaluation.reasons.length > 0
                ? <ul className="block-list">{evaluation.reasons.map((reason, index) => <li key={index}>{reason.text}</li>)}</ul>
                : <p className="ready-text">各控制点全部合格，偏差均已获后续合格读数确认，可提交放行复核。</p>}

              <h3>录入 / 补录监测读数</h3>
              <div className="reading-form">
                <Field label="控制点">
                  <Dropdown value={readingForm.stepId ? evaluation.matrix.steps.find((s) => s.id === readingForm.stepId)?.controlPoint ?? '' : ''}
                    selectedOptions={[readingForm.stepId]} placeholder="选择控制点"
                    onOptionSelect={(_, data) => setReadingForm((f) => ({ ...f, stepId: data.optionValue ?? '' }))}>
                    {evaluation.matrix.steps.map((step) => <Option key={step.id} value={step.id} text={step.controlPoint}>{step.controlPoint}（{step.limit}）</Option>)}
                  </Dropdown>
                </Field>
                <Field label={`读数${readingForm.stepId ? `（限值 ${evaluation.matrix.steps.find((s) => s.id === readingForm.stepId)?.limit}）` : ''}`}>
                  <Input type="number" value={readingForm.value} onChange={(_, data) => setReadingForm((f) => ({ ...f, value: data.value }))} />
                </Field>
                <Field label="读数时间"><Input type="datetime-local" value={readingForm.recordedAt} onChange={(_, data) => setReadingForm((f) => ({ ...f, recordedAt: data.value }))} /></Field>
                <Field label="来源">
                  <Dropdown value={readingForm.source} selectedOptions={[readingForm.source]} onOptionSelect={(_, data) => setReadingForm((f) => ({ ...f, source: data.optionValue as MonitoringSource }))}>
                    {['人工录入', '在线采集', '补录'].map((item) => <Option key={item} value={item}>{item}</Option>)}
                  </Dropdown>
                </Field>
                <Button className="reading-send" appearance="secondary" disabled={!readingForm.stepId || readingForm.value === ''} onClick={sendReading}>提交读数</Button>
              </div>
              {readingMessage && <p className={readingMessage.kind === 'ok' ? 'ready-text' : 'validation-text'}>{readingMessage.text}</p>}

              <h3>放行结论提交</h3>
              <Field label="结论备注"><Input value={note} placeholder={draft ? `保留草稿：${draft.note}` : '输入放行意见'} onChange={(_, data) => setNote(data.value)} /></Field>
              <Field label="签字人"><Input value={signer} onChange={(_, data) => setSigner(data.value)} /></Field>
              <div className="record-actions">
                <Button appearance="secondary" disabled={!evaluation.ready} onClick={() => doSubmit('提交复核')}>提交放行复核</Button>
                <Button appearance="primary" disabled={selected.status !== '可放行' || !evaluation.ready} onClick={() => doSubmit('签字放行')}>签字放行</Button>
              </div>
              {draft && <p className="draft-note">本机保留着基于结论版本 V{draft.baseSeq} 的填值（{draft.note}）；若另一终端已先提交，请核对后再决定。</p>}
              {submitMessage && <p className={submitMessage.kind === 'ok' ? 'ready-text' : 'validation-text'}>{submitMessage.text}</p>}
            </>
          )}
          {selectedDeviations.length > 0 && <div className="batch-deviations">
            <h3>关联偏差</h3>
            {selectedDeviations.map((item) => {
              const confirmed = evaluation.confirmations[item.id]
              return <div key={item.id} className="dev-chip">
                <Badge appearance="tint" color={item.status === '已关闭' ? confirmed ? 'success' : 'warning' : 'danger'}>{item.status}</Badge>
                <span>{item.id} · {item.title}</span>
                <small>依据 {item.basisLimit}{item.status === '已关闭' ? (confirmed ? ' · 已获后续合格确认' : ' · 等待后续合格读数确认') : ''}</small>
              </div>
            })}
          </div>}
        </aside>}
      </div>

      {showNewBatch && <div className="edit-panel">
        <h3>新批次投产（投产时刻固定当前生效矩阵）</h3>
        <div className="edit-grid">
          <Field label="产品"><Input value={newBatch.product} onChange={(_, data) => setNewBatch({ ...newBatch, product: data.value })} /></Field>
          <Field label="产线"><Input value={newBatch.line} onChange={(_, data) => setNewBatch({ ...newBatch, line: data.value })} /></Field>
          <Field label="数量"><Input type="number" value={String(newBatch.quantity)} onChange={(_, data) => setNewBatch({ ...newBatch, quantity: Number(data.value) })} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setShowNewBatch(false)}>取消</Button><Button appearance="primary" disabled={!newBatch.product} onClick={() => { dispatch(createBatch({ ...newBatch, operator: terminal.terminalName })); setShowNewBatch(false) }}>投产并固定依据</Button></div>
      </div>}
    </section>
  )
}

function ConclusionTable({ lines }: { lines: ReturnType<typeof evaluateBasis>['lines'] }) {
  return <div className="conclusion-list">
    {lines.map((line) => <div key={line.stepId} className={line.compliant === null ? 'missing' : line.compliant ? 'pass' : 'fail'}>
      <span>{line.controlPoint}<small>{line.limit}</small></span>
      <strong>{line.value === null ? '待读数' : `${line.value} ${line.unit}`}</strong>
      <em>{line.compliant === null ? '未监测' : line.compliant ? '合格' : '超限'}{line.source ? ` · ${line.source}` : ''}</em>
    </div>)}
  </div>
}
