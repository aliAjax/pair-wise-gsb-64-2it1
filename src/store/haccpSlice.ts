import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { matrixForBatch, matrixById, matrixLabel, evaluateBasis, isCompliant, readingCompliant } from '../services/basis'
import { matrixVersions, seedAudit, seedBatches, seedDeviations } from '../data/seed'
import type {
  AuditEntry, Batch, BatchStatus, Deviation, Investigation, MatrixVersion,
  MonitoringValue, ProcessStep, ReadingInput
} from '../types'

interface HaccpState {
  matrices: MatrixVersion[]
  batches: Batch[]
  deviations: Deviation[]
  audit: AuditEntry[]
  batchFilter: string
  batchStatus: BatchStatus | '全部'
  selectedBatchId: string | null
  /** 最近一次读数落库结果，供 thunk 读取（非业务数据，不参与展示） */
  lastIngest?: { batchId: string; clientId: string; duplicate: boolean; openedDeviationId?: string; at: string }
}

const STORAGE_KEY = 'gsb64:haccp-platform'

function freshState(): HaccpState {
  return {
    matrices: structuredClone(matrixVersions),
    batches: structuredClone(seedBatches),
    deviations: structuredClone(seedDeviations),
    audit: structuredClone(seedAudit),
    batchFilter: '', batchStatus: '全部', selectedBatchId: seedBatches[0].id
  }
}

/** 旧版本持久化数据迁移：补齐版本化矩阵与结论字段 */
function migrate(raw: Partial<HaccpState>): HaccpState {
  const base = freshState()
  const matrices = (raw.matrices?.length ? raw.matrices : base.matrices) as MatrixVersion[]
  const batches = (raw.batches?.length ? raw.batches : base.batches) as Batch[]
  for (const batch of batches) {
    if (!batch.matrixVersionId) batch.matrixVersionId = matrixForBatch(matrices, batch.producedAt).id
    if (batch.conclusionSeq === undefined) batch.conclusionSeq = batch.release ? 2 : 0
    if (!batch.recalculatedAt) batch.recalculatedAt = ''
    for (const reading of batch.monitoring) {
      if (!reading.id) reading.id = `M-${nanoid(6)}`
      if (!reading.clientId) reading.clientId = reading.id
      if (!reading.source) reading.source = '人工录入'
      if (reading.backfilled === undefined) reading.backfilled = reading.source === '补录'
    }
  }
  const deviations = (raw.deviations?.length ? raw.deviations : base.deviations) as Deviation[]
  for (const deviation of deviations) {
    if (!deviation.basisMatrixId) {
      const batch = batches.find((item) => item.id === deviation.batchId)
      deviation.basisMatrixId = batch?.matrixVersionId ?? matrices[0].id
      deviation.basisLimit = matrixById(matrices, deviation.basisMatrixId).steps.find((s) => s.id === deviation.stepId)?.limit ?? ''
    }
  }
  return {
    matrices, batches, deviations,
    audit: (raw.audit?.length ? raw.audit : base.audit) as AuditEntry[],
    batchFilter: raw.batchFilter ?? '',
    batchStatus: raw.batchStatus ?? '全部',
    selectedBatchId: raw.selectedBatchId ?? batches[0]?.id ?? null
  }
}

function initialState(): HaccpState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrate(JSON.parse(raw))
  } catch {
    // 本地存储不可用时使用演示数据。
  }
  return freshState()
}

function log(state: HaccpState, entity: string, action: string, operator: string, detail: string) {
  state.audit.unshift({ id: nanoid(), entity, action, operator, detail, createdAt: new Date().toISOString() })
}

/** 依据统一判定结果同步批次流转状态（只读未签字批次，签字批次冻结） */
function applyGatingStatus(state: HaccpState, batch: Batch) {
  if (batch.release) return
  const evaluation = evaluateBasis(batch, state.deviations, state.matrices)
  if (evaluation.ready) {
    if (batch.status === '隔离中' || batch.status === '生产中') batch.status = '待复核'
  } else {
    if (batch.status === '可放行' || batch.status === '待复核') batch.status = '隔离中'
  }
}

/** 监测点读数落库（幂等），超限自动开偏差；返回由 thunk 旁路读取，reducer 内只改状态 */
function ingest(state: HaccpState, input: ReadingInput): { duplicate: boolean; openedDeviationId?: string } {
  const batch = state.batches.find((item) => item.id === input.batchId)
  if (!batch || batch.release) return { duplicate: false }
  // 幂等：同一终端补传的相同 clientId 直接丢弃，绝不重复开偏差
  if (batch.monitoring.some((item) => item.clientId === input.clientId)) {
    return { duplicate: true }
  }
  const matrix = matrixById(state.matrices, batch.matrixVersionId)
  const step: ProcessStep | undefined = matrix.steps.find((item) => item.id === input.stepId)
  if (!step) return { duplicate: false }

  const backfilled = input.source === '补录'
  const reading: MonitoringValue = {
    id: `M-${nanoid(8)}`, clientId: input.clientId, stepId: input.stepId, value: input.value,
    unit: input.unit || step.spec.unit, recordedAt: input.recordedAt, operator: input.operator,
    source: input.source, backfilled
  }
  batch.monitoring.push(reading)
  batch.version += 1
  log(state, batch.id, backfilled ? '补录监测读数' : '录入监测读数', input.operator,
    `${step.controlPoint} ${input.value}${input.unit || step.spec.unit}，依据 ${matrixLabel(matrix)} 限值 ${step.limit}`)

  let openedDeviationId: string | undefined
  if (!isCompliant(input.value, step.spec)) {
    // 关闭偏差绝不因补录重新挑起：同控制点存在未关闭偏差则归集，否则新开偏差
    const existing = state.deviations.find((item) => item.batchId === batch.id && item.stepId === input.stepId && item.status !== '已关闭')
    if (existing) {
      log(state, existing.id, '超限读数归集', input.operator,
        `${backfilled ? '补录' : ''}读数 ${input.value}${input.unit} 超出限值 ${step.limit}，偏差 ${existing.id} 处理中，不重复开偏差`)
    } else {
      const now = new Date()
      const deviation: Deviation = {
        id: `DEV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${nanoid(3)}`.toUpperCase(),
        batchId: batch.id, stepId: input.stepId,
        title: `${step.controlPoint}${backfilled ? '补录' : ''}读数超出关键限值`,
        severity: step.id === 'P2' ? '重大' : '一般',
        status: '待调查', owner: input.operator, openedAt: input.recordedAt,
        dueDate: now.toISOString().slice(0, 10), reviewNote: '', reviewer: '', version: 1,
        basisMatrixId: matrix.id, basisLimit: step.limit, sourceReadingId: reading.id, autoOpened: true,
        investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }
      }
      state.deviations.unshift(deviation)
      openedDeviationId = deviation.id
      batch.status = '隔离中'
      log(state, deviation.id, '超限自动开偏差', input.operator,
        `${backfilled ? '补录' : '在线'}读数 ${input.value}${step.spec.unit} 超出${matrixLabel(matrix)}限值 ${step.limit}，批次 ${batch.id} 已隔离并冻结放行`)
    }
  } else {
    // 合格补录：检查是否确认了已关闭偏差（同一控制点、关闭时间之后的合格读数）
    for (const deviation of state.deviations) {
      if (deviation.batchId !== batch.id || deviation.stepId !== input.stepId || deviation.status !== '已关闭') continue
      if (deviation.confirmationReadingId) continue
      if (deviation.closedAt && input.recordedAt >= deviation.closedAt && readingCompliant(reading, matrix)) {
        deviation.confirmationReadingId = reading.id
        log(state, deviation.id, '关闭偏差获合格确认', input.operator,
          `${step.controlPoint}后续合格读数 ${input.value}${step.spec.unit}（${input.source}）满足限值 ${step.limit}`)
      }
    }
  }
  applyGatingStatus(state, batch)
  return { duplicate: false, openedDeviationId }
}

const slice = createSlice({
  name: 'haccp',
  initialState,
  reducers: {
    setBatchFilter(state, action: PayloadAction<string>) { state.batchFilter = action.payload },
    setBatchStatus(state, action: PayloadAction<BatchStatus | '全部'>) { state.batchStatus = action.payload },
    setSelectedBatch(state, action: PayloadAction<string | null>) { state.selectedBatchId = action.payload },

    /** 发布控制矩阵新版本；未签字批次立即按新依据重算，已签字批次保持冻结 */
    publishMatrix(state, action: PayloadAction<{ steps: ProcessStep[]; effectiveAt: string; note: string; publishedBy: string }>) {
      const version = Math.max(...state.matrices.map((item) => item.version)) + 1
      const matrix: MatrixVersion = {
        id: `MX-2026-${String(version).padStart(2, '0')}`, version,
        effectiveAt: action.payload.effectiveAt, publishedAt: new Date().toISOString(),
        publishedBy: action.payload.publishedBy, note: action.payload.note, steps: action.payload.steps
      }
      state.matrices.push(matrix)
      const now = new Date().toISOString()
      const recalculated: string[] = []
      const pinnedOld: string[] = []
      const frozen: string[] = []
      for (const batch of state.batches) {
        if (batch.release) { frozen.push(batch.id); continue }
        if (batch.matrixVersionId !== matrix.id) { pinnedOld.push(batch.id); continue }
        // 固定到新版的未签字批次：结论立即重算
        batch.recalculatedAt = now
        batch.version += 1
        applyGatingStatus(state, batch)
        recalculated.push(batch.id)
      }
      log(state, matrix.id, '发布控制矩阵', action.payload.publishedBy,
        `V${version} 自 ${matrix.effectiveAt.replace('T', ' ').slice(0, 16)} 生效；固定本版的未签字批次 ${recalculated.join('、') || '无'} 立即重算；投产更早的批次 ${pinnedOld.join('、') || '无'} 继续按原版本判定；已签字批次 ${frozen.join('、') || '无'} 按原依据冻结展示。${action.payload.note}`)
    },

    commitReading(state, action: PayloadAction<ReadingInput>) {
      const result = ingest(state, action.payload)
      state.lastIngest = { ...result, batchId: action.payload.batchId, clientId: action.payload.clientId, at: new Date().toISOString() }
    },

    createBatch(state, action: PayloadAction<{ product: string; line: string; quantity: number; operator: string }>) {
      const now = new Date()
      const id = `B${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${nanoid(2)}`.toUpperCase()
      const matrix = matrixForBatch(state.matrices, now.toISOString())
      const batch: Batch = {
        id, product: action.payload.product, line: action.payload.line, quantity: action.payload.quantity,
        producedAt: now.toISOString(), status: '生产中', isolationScope: '无', monitoring: [], version: 1,
        matrixVersionId: matrix.id, conclusionSeq: 0, recalculatedAt: ''
      }
      state.batches.unshift(batch)
      state.selectedBatchId = batch.id
      log(state, batch.id, '批次投产', action.payload.operator, `投产时刻固定生效依据 ${matrixLabel(matrix)}（${matrix.id}），后续矩阵改版不影响本批次`)
    },

    createDeviation(state, action: PayloadAction<{ batchId: string; stepId: string; title: string; severity: '一般' | '重大'; owner: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || batch.release) return
      const matrix = matrixById(state.matrices, batch.matrixVersionId)
      const step = matrix.steps.find((item) => item.id === action.payload.stepId)
      const now = new Date()
      const deviation: Deviation = {
        id: `DEV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${nanoid(3)}`.toUpperCase(),
        ...action.payload, status: '待调查', openedAt: now.toISOString(),
        dueDate: now.toISOString().slice(0, 10), reviewNote: '', reviewer: '', version: 1,
        basisMatrixId: matrix.id, basisLimit: step?.limit ?? '',
        investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }
      }
      state.deviations.unshift(deviation)
      batch.status = '隔离中'
      batch.version += 1
      applyGatingStatus(state, batch)
      log(state, deviation.id, '手动登记偏差', action.payload.owner, `批次 ${batch.id} 依据 ${matrixLabel(matrix)} 限值 ${step?.limit ?? ''} 隔离并冻结放行`)
    },

    saveInvestigation(state, action: PayloadAction<{ id: string; investigation: Investigation }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation || !action.payload.investigation.cause.trim() || !action.payload.investigation.evidence.trim()) return
      deviation.investigation = action.payload.investigation
      deviation.status = '待复核'
      deviation.version += 1
      log(state, deviation.id, '提交偏差调查', deviation.owner, `处置分支：${deviation.investigation.decision}（依据 ${deviation.basisLimit}）`)
    },

    reviewDeviation(state, action: PayloadAction<{ id: string; approved: boolean; note: string; reviewer: string }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation) return
      if (action.payload.approved && !action.payload.note.trim()) return
      deviation.reviewNote = action.payload.note
      deviation.reviewer = action.payload.reviewer
      deviation.version += 1
      if (action.payload.approved) {
        deviation.status = '已关闭'
        deviation.closedAt = new Date().toISOString()
        log(state, deviation.id, '复核通过关闭偏差', action.payload.reviewer,
          `${action.payload.note}；须等待同一控制点后续合格读数确认后方可恢复放行`)
      } else {
        deviation.status = '调查中'
        log(state, deviation.id, '退回补证', action.payload.reviewer, action.payload.note || '退回调查')
      }
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      if (batch) applyGatingStatus(state, batch)
    },

    /** 结论提交/签字的落库动作（先到者生效），冲突由 thunk 在提交前拦截 */
    commitConclusion(state, action: PayloadAction<{
      batchId: string; action: '提交复核' | '签字放行'; note: string; signer: string
      terminalId: string; terminalName: string
    }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || batch.release) return
      const evaluation = evaluateBasis(batch, state.deviations, state.matrices)
      if (!evaluation.ready) return
      batch.conclusionSeq += 1
      batch.lastConclusion = {
        terminalId: action.payload.terminalId, terminalName: action.payload.terminalName,
        action: action.payload.action, at: new Date().toISOString(), note: action.payload.note
      }
      if (action.payload.action === '签字放行') {
        batch.status = '已放行'
        batch.release = {
          signedAt: new Date().toISOString(), signer: action.payload.signer,
          terminalId: action.payload.terminalId, terminalName: action.payload.terminalName,
          note: action.payload.note, matrixVersionId: evaluation.matrix.id,
          matrixLabel: matrixLabel(evaluation.matrix), seq: batch.conclusionSeq,
          lines: structuredClone(evaluation.lines)
        }
      } else {
        batch.status = '可放行'
      }
      batch.version += 1
      log(state, batch.id, action.payload.action, action.payload.terminalName,
        action.payload.action === '签字放行'
          ? `依据 ${matrixLabel(evaluation.matrix)}（${evaluation.matrix.id}）冻结结论并签字：${action.payload.note}`
          : `依据 ${matrixLabel(evaluation.matrix)} 判定全部控制点合格，提交放行复核`)
    },

    /** 测试/数据修复辅助：重新固定批次依据后立即重算（正常业务只在投产时固定） */
    pinBatchMatrix(state, action: PayloadAction<{ batchId: string; matrixVersionId: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      const matrix = state.matrices.find((item) => item.id === action.payload.matrixVersionId)
      if (!batch || !matrix || batch.release) return
      batch.matrixVersionId = matrix.id
      batch.recalculatedAt = new Date().toISOString()
      batch.version += 1
      applyGatingStatus(state, batch)
    },

    /** 接收另一终端广播来的共享状态（先到者结论随之可见） */
    hydrateShared(state, action: PayloadAction<HaccpState>) {
      return action.payload
    },

    resetDemo() {
      return freshState()
    }
  }
})

export const {
  setBatchFilter, setBatchStatus, setSelectedBatch, publishMatrix, commitReading,
  createBatch, createDeviation, saveInvestigation, reviewDeviation, commitConclusion,
  pinBatchMatrix, hydrateShared, resetDemo
} = slice.actions
export { STORAGE_KEY, ingest }
export default slice.reducer
