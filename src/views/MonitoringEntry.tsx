import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Badge, Button, Dropdown, Input, Option } from '@fluentui/react-components'
import { nanoid } from '@reduxjs/toolkit'
import type { AppDispatch } from '../store'
import { addMonitoringReading } from '../store/haccpSlice'
import { readDrafts, upsertDraft } from '../services/drafts'
import type { Batch, ProcessStep } from '../types'

interface EntryForm {
  submissionId: string
  stepId: string
  value: string
  unit: string
  operator: string
  recordedAt: string
}

function defaultUnit(step: ProcessStep | undefined): string {
  if (!step) return ''
  if (step.limit.includes('℃')) return '℃'
  if (step.limit.includes('MPa')) return 'MPa'
  if (/mm/i.test(step.limit)) return 'mm Fe'
  return ''
}

const localDateTime = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function freshForm(steps: ProcessStep[]): EntryForm {
  const stepId = steps[0]?.id ?? ''
  return { submissionId: nanoid(), stepId, value: '', unit: defaultUnit(steps.find((item) => item.id === stepId)), operator: '', recordedAt: localDateTime(new Date()) }
}

/** 补录监测读数：草稿独立持久化，本地写入失败后可恢复未完成监测点 */
export function MonitoringEntry({ batch, steps }: { batch: Batch; steps: ProcessStep[] }) {
  const dispatch = useDispatch<AppDispatch>()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<EntryForm>(() => freshForm(steps))
  const [restored, setRestored] = useState(false)

  // 恢复本批次未完成的监测点草稿
  useEffect(() => {
    const draft = readDrafts().find((item) => item.batchId === batch.id && item.status === '编辑中')
    if (draft) {
      setForm({ submissionId: draft.submissionId, stepId: draft.stepId, value: draft.value, unit: draft.unit, operator: draft.operator, recordedAt: draft.recordedAt })
      setRestored(true)
      setOpen(true)
    } else {
      setForm(freshForm(steps))
      setRestored(false)
    }
  }, [batch.id])

  const update = (patch: Partial<EntryForm>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch }
      upsertDraft({ ...next, batchId: batch.id, status: '编辑中', savedAt: new Date().toISOString() })
      return next
    })
  }

  const changeStep = (stepId: string) => update({ stepId, unit: defaultUnit(steps.find((item) => item.id === stepId)) })

  const submit = () => {
    const recordedAt = form.recordedAt.length === 16 ? `${form.recordedAt}:00` : form.recordedAt
    upsertDraft({ ...form, recordedAt, batchId: batch.id, status: '已提交', savedAt: new Date().toISOString() })
    dispatch(addMonitoringReading({ batchId: batch.id, stepId: form.stepId, value: Number(form.value), unit: form.unit, operator: form.operator.trim(), recordedAt, submissionId: form.submissionId }))
    setForm(freshForm(steps))
    setRestored(false)
  }

  const valid = form.stepId && form.value !== '' && Number.isFinite(Number(form.value)) && form.operator.trim() && form.recordedAt
  const backfill = form.recordedAt && new Date(form.recordedAt).getTime() < Date.now() - 30 * 60 * 1000

  if (!open) return <div className="record-actions"><Button appearance="outline" onClick={() => setOpen(true)}>补录监测读数</Button></div>
  return <div className="monitoring-entry">
    <h3>补录监测读数 {restored && <Badge appearance="tint" color="warning">已恢复未完成草稿</Badge>}</h3>
    <div className="entry-grid">
      <Dropdown value={steps.find((item) => item.id === form.stepId)?.controlPoint ?? ''} selectedOptions={[form.stepId]} onOptionSelect={(_, data) => changeStep(data.optionValue ?? form.stepId)}>
        {steps.map((step) => <Option key={step.id} value={step.id} text={step.controlPoint}>{step.controlPoint}</Option>)}
      </Dropdown>
      <Input type="number" placeholder="读数" value={form.value} onChange={(_, data) => update({ value: data.value })} />
      <Input placeholder="单位" value={form.unit} onChange={(_, data) => update({ unit: data.value })} />
      <Input placeholder="记录人" value={form.operator} onChange={(_, data) => update({ operator: data.value })} />
      <Input type="datetime-local" value={form.recordedAt} onChange={(_, data) => update({ recordedAt: data.value })} />
    </div>
    {backfill && <p className="hint-text">记录时间早于当前，将作为补录读数；若超出限值将先开偏差并冻结放行，已被已关闭偏差覆盖的历史读数不会重复开偏差。</p>}
    <div className="record-actions">
      <Button onClick={() => setOpen(false)}>收起</Button>
      <Button appearance="primary" disabled={!valid} onClick={submit}>提交读数</Button>
    </div>
  </div>
}
