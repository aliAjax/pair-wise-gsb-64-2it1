import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { initialMatrixVersion, seedAudit, seedBatches, seedDeviations, seedMatrixVersions, processSteps } from '../data/seed'
import { computeConclusion, effectiveMatrixVersionId, evaluateLimit, isTerminal, stepsOfVersion } from '../services/conclusion'
import type { AuditEntry, Batch, BatchStatus, Deviation, Investigation, MatrixVersion, MonitoringValue, ProcessStep, ReleaseConflict } from '../types'

interface HaccpState {
  batches: Batch[]
  deviations: Deviation[]
  processSteps: ProcessStep[]
  matrixVersions: MatrixVersion[]
  currentMatrixVersionId: string
  releaseConflicts: Record<string, ReleaseConflict>
  audit: AuditEntry[]
  batchFilter: string
  batchStatus: BatchStatus | '全部'
  selectedBatchId: string | null
}

interface PersistedState extends HaccpState {}
const STORAGE_KEY = 'gsb64:haccp-platform'

/** 本地朴素时间戳（YYYY-MM-DDTHH:mm:ss），与种子数据格式一致，保证记录时间可字符串比较 */
const now = () => {
  const date = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const tomorrow = () => {
  const date = new Date(Date.now() + 86400000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 批次当前生效依据对应的控制点集合：投产钉住版本优先，未投产跟随当前矩阵 */
function effectiveSteps(state: HaccpState, batch: Batch): ProcessStep[] {
  const versionId = isTerminal(batch)
    ? batch.signedMatrixVersionId ?? effectiveMatrixVersionId(batch, state.currentMatrixVersionId)
    : effectiveMatrixVersionId(batch, state.currentMatrixVersionId)
  return stepsOfVersion(state.matrixVersions, versionId, state.processSteps)
}

/** 重算单个批次结论；已签字批次冻结结论，继续按原依据展示 */
function refreshConclusion(state: HaccpState, batch: Batch) {
  if (isTerminal(batch)) return
  const versionId = effectiveMatrixVersionId(batch, state.currentMatrixVersionId)
  batch.conclusion = computeConclusion(batch, state.deviations, stepsOfVersion(state.matrixVersions, versionId, state.processSteps), versionId, now())
}

/** 矩阵更新后，所有未签字批次的结论立即按各自生效依据重算 */
function recalcUnsignedConclusions(state: HaccpState) {
  state.batches.forEach((batch) => refreshConclusion(state, batch))
}

function log(state: HaccpState, entity: string, action: string, operator: string, detail: string) {
  state.audit.unshift({ id: nanoid(), entity, action, operator, detail, createdAt: now() })
}

function seedState(): HaccpState {
  const state: HaccpState = {
    batches: structuredClone(seedBatches),
    deviations: structuredClone(seedDeviations),
    processSteps: structuredClone(processSteps),
    matrixVersions: structuredClone(seedMatrixVersions),
    currentMatrixVersionId: initialMatrixVersion.id,
    releaseConflicts: {},
    audit: structuredClone(seedAudit),
    batchFilter: '',
    batchStatus: '全部',
    selectedBatchId: seedBatches[0].id
  }
  state.batches.forEach((batch) => {
    const versionId = batch.signedMatrixVersionId ?? effectiveMatrixVersionId(batch, state.currentMatrixVersionId)
    batch.conclusion = computeConclusion(batch, state.deviations, stepsOfVersion(state.matrixVersions, versionId, state.processSteps), versionId, batch.signedAt ?? now())
  })
  return state
}

/** 兼容旧版本持久化数据：补齐矩阵版本、幂等键与结论，已签字批次固定到升级前实际使用的矩阵 */
function migrateState(raw: Partial<HaccpState>): HaccpState {
  const base = seedState()
  const clean = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)) as Partial<HaccpState>
  // 旧版本没有矩阵版本概念：若用户改过控制矩阵，把旧矩阵固化为一个历史版本作为既有批次的依据
  let matrixVersions = clean.matrixVersions?.length ? clean.matrixVersions : base.matrixVersions
  let currentMatrixVersionId = clean.currentMatrixVersionId ?? base.currentMatrixVersionId
  let legacyVersionId = initialMatrixVersion.id
  if (!clean.matrixVersions?.length && clean.processSteps && JSON.stringify(clean.processSteps) !== JSON.stringify(initialMatrixVersion.steps)) {
    const legacy: MatrixVersion = {
      id: 'MV-LEGACY', version: matrixVersions.length + 1, publishedAt: now(), publishedBy: '系统迁移',
      note: '升级前在用的控制矩阵', steps: clean.processSteps.map((step) => ({ ...step }))
    }
    matrixVersions = [...matrixVersions, legacy]
    currentMatrixVersionId = legacy.id
    legacyVersionId = legacy.id
  }
  const state: HaccpState = {
    ...base,
    ...clean,
    matrixVersions,
    currentMatrixVersionId,
    releaseConflicts: clean.releaseConflicts ?? {},
    batches: (clean.batches ?? base.batches).map((batch, index) => ({
      ...batch,
      matrixVersionId: batch.matrixVersionId === undefined ? (batch.status === '待投产' ? null : legacyVersionId) : batch.matrixVersionId,
      signedMatrixVersionId: batch.signedMatrixVersionId ?? (isTerminal(batch) ? legacyVersionId : undefined),
      conclusion: batch.conclusion ?? null,
      monitoring: (batch.monitoring ?? []).map((reading, readingIndex) => ({
        ...reading,
        submissionId: reading.submissionId ?? `LEGACY-${batch.id}-${reading.stepId}-${index}-${readingIndex}`,
        submittedAt: reading.submittedAt ?? reading.recordedAt
      }))
    })),
    deviations: (clean.deviations ?? base.deviations).map((deviation) => ({ ...deviation }))
  }
  state.batches.forEach((batch) => {
    const versionId = batch.signedMatrixVersionId ?? effectiveMatrixVersionId(batch, state.currentMatrixVersionId)
    batch.conclusion = computeConclusion(batch, state.deviations, stepsOfVersion(state.matrixVersions, versionId, state.processSteps), versionId, batch.signedAt ?? now())
  })
  return state
}

function initialState(): HaccpState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrateState(JSON.parse(raw))
  } catch {
    // 本地存储不可用或损坏时回退到演示数据
  }
  return seedState()
}

const slice = createSlice({
  name: 'haccp',
  initialState,
  reducers: {
    setBatchFilter(state, action: PayloadAction<string>) { state.batchFilter = action.payload },
    setBatchStatus(state, action: PayloadAction<BatchStatus | '全部'>) { state.batchStatus = action.payload },
    setSelectedBatch(state, action: PayloadAction<string | null>) { state.selectedBatchId = action.payload },
    /** 修改控制措施 = 发布新的矩阵版本；未签字结论立即按各自生效依据重算 */
    updateProcessStep(state, action: PayloadAction<ProcessStep>) {
      const index = state.processSteps.findIndex((item) => item.id === action.payload.id)
      if (index < 0 || !action.payload.limit.trim() || !action.payload.correctiveAction.trim()) return
      const steps = state.processSteps.map((item) => (item.id === action.payload.id ? action.payload : item))
      const version: MatrixVersion = {
        id: `MV-${state.matrixVersions.length + 1}`,
        version: state.matrixVersions.length + 1,
        publishedAt: now(),
        publishedBy: '质量主管',
        note: `更新${action.payload.name}关键限值或监控要求`,
        steps: steps.map((step) => ({ ...step }))
      }
      state.matrixVersions.push(version)
      state.currentMatrixVersionId = version.id
      state.processSteps = steps
      recalcUnsignedConclusions(state)
      log(state, version.id, '发布矩阵版本', '质量主管', `${version.note}；未签字批次结论已按各自生效依据立即重算`)
    },
    updateBatchStatus(state, action: PayloadAction<{ id: string; status: BatchStatus }>) {
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch || isTerminal(batch) || action.payload.status === '已放行') return
      if (action.payload.status === '可放行' && batch.conclusion?.outcome !== '符合放行') return
      if (action.payload.status === '生产中' && !batch.matrixVersionId) {
        batch.matrixVersionId = state.currentMatrixVersionId
        log(state, batch.id, '投产固定依据', '生产调度', `批次投产，控制矩阵固定为${state.currentMatrixVersionId}`)
      }
      batch.status = action.payload.status
      batch.version += 1
      refreshConclusion(state, batch)
      log(state, batch.id, '批次状态流转', '质量主管', `状态更新为${action.payload.status}`)
    },
    /**
     * 补录/采集监测读数：submissionId 幂等，重复补传直接忽略；
     * 超限先开偏差并冻结放行；已被已关闭偏差覆盖的历史补录不再重新挑起偏差；
     * 偏差关闭后，同一控制点的后续合格读数用于确认。
     */
    addMonitoringReading(state, action: PayloadAction<{ batchId: string; stepId: string; value: number; unit: string; operator: string; recordedAt: string; submissionId: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || isTerminal(batch) || batch.status === '待投产') return
      if (batch.monitoring.some((reading) => reading.submissionId === action.payload.submissionId)) return
      const reading: MonitoringValue = { ...action.payload, submittedAt: now() }
      batch.monitoring.push(reading)
      batch.monitoring.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      batch.version += 1

      const step = effectiveSteps(state, batch).find((item) => item.id === reading.stepId)
      const inLimit = step ? evaluateLimit(step.limit, reading.value) : true
      if (inLimit) {
        state.deviations
          .filter((item) => item.batchId === batch.id && item.stepId === reading.stepId && item.status === '已关闭' && !item.confirmedAt && !!item.closedAt && item.closedAt < reading.recordedAt)
          .forEach((deviation) => {
            deviation.confirmedAt = now()
            deviation.confirmationSubmissionId = reading.submissionId
            deviation.version += 1
            log(state, deviation.id, '偏差确认', reading.operator, `控制点后续合格读数${reading.value}${reading.unit}，偏差关闭生效`)
          })
      } else if (step) {
        const alreadyLinked = state.deviations.some((item) => item.sourceSubmissionId === reading.submissionId)
        const hasOpen = state.deviations.some((item) => item.batchId === batch.id && item.stepId === step.id && item.status !== '已关闭')
        const coveredByClosed = state.deviations.some((item) => item.batchId === batch.id && item.stepId === step.id && item.status === '已关闭' && !!item.closedAt && item.closedAt >= reading.recordedAt)
        if (!alreadyLinked && !hasOpen && !coveredByClosed) {
          const deviation: Deviation = {
            id: `DEV-${nanoid(8)}`,
            batchId: batch.id, stepId: step.id, title: `${step.controlPoint}超出关键限值`, severity: '重大', status: '待调查',
            owner: '质量工程组', openedAt: now(), dueDate: tomorrow(),
            investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' },
            reviewNote: '', reviewer: '', version: 1, sourceSubmissionId: reading.submissionId
          }
          state.deviations.unshift(deviation)
          batch.status = '隔离中'
          batch.isolationScope = `${step.name}控制点超限，待偏差${deviation.id}调查`
          log(state, deviation.id, '自动创建偏差', '监控系统', `${step.controlPoint}读数${reading.value}${reading.unit}超出限值${step.limit}，批次已冻结放行`)
        }
      }
      refreshConclusion(state, batch)
      log(state, batch.id, '补录监测读数', reading.operator, `${step?.controlPoint ?? reading.stepId}：${reading.value}${reading.unit}（${inLimit ? '合格' : '超限'}）`)
    },
    createDeviation(state, action: PayloadAction<{ batchId: string; stepId: string; title: string; severity: '一般' | '重大'; owner: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || isTerminal(batch)) return
      const deviation: Deviation = {
        id: `DEV-${nanoid(8)}`, ...action.payload, status: '待调查', openedAt: now(),
        dueDate: tomorrow(), reviewNote: '', reviewer: '', version: 1,
        investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }
      }
      state.deviations.unshift(deviation)
      batch.status = '隔离中'
      batch.version += 1
      refreshConclusion(state, batch)
      log(state, deviation.id, '创建偏差调查', '当前用户', `批次${batch.id}因${action.payload.title}进入隔离`)
    },
    saveInvestigation(state, action: PayloadAction<{ id: string; investigation: Investigation }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation || !action.payload.investigation.cause.trim() || !action.payload.investigation.evidence.trim()) return
      deviation.investigation = action.payload.investigation
      deviation.status = '待复核'
      deviation.version += 1
      log(state, deviation.id, '提交偏差调查', deviation.owner, `处置分支：${deviation.investigation.decision}`)
    },
    reviewDeviation(state, action: PayloadAction<{ id: string; approved: boolean; note: string; reviewer: string }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation) return
      if (action.payload.approved && !action.payload.note.trim()) return
      deviation.reviewNote = action.payload.note
      deviation.reviewer = action.payload.reviewer
      deviation.status = action.payload.approved ? '已关闭' : '调查中'
      if (action.payload.approved) deviation.closedAt = now()
      deviation.version += 1
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      if (batch && action.payload.approved && !state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭' && item.id !== deviation.id)) {
        batch.status = deviation.investigation.decision === '报废' ? '已报废' : '待复核'
        batch.version += 1
      }
      if (batch) refreshConclusion(state, batch)
      log(state, deviation.id, action.payload.approved ? '复核通过' : '退回补证', action.payload.reviewer, action.payload.note || '退回调查')
    },
    /**
     * 签字放行（提交批次结论）：携带提交时看到的批次版本，先到者生效；
     * 版本不一致说明另一终端已先行提交，本次填值保留并记录冲突。
     */
    signRelease(state, action: PayloadAction<{ batchId: string; expectedVersion: number; signer: string; note: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || !action.payload.signer.trim()) return
      // 版本不一致说明另一终端已先行提交：先到者生效，本次填值保留并提示冲突
      if (batch.version !== action.payload.expectedVersion) {
        state.releaseConflicts[batch.id] = {
          batchId: batch.id, signer: action.payload.signer, note: action.payload.note,
          attemptedAt: now(), baseVersion: action.payload.expectedVersion, currentVersion: batch.version
        }
        log(state, batch.id, '放行提交冲突', action.payload.signer, `基于版本V${action.payload.expectedVersion}的提交被驳回，当前版本V${batch.version}，填值已保留`)
        return
      }
      if (isTerminal(batch) || batch.status !== '可放行' || batch.conclusion?.outcome !== '符合放行') return
      batch.status = '已放行'
      batch.signedAt = now()
      batch.signedBy = action.payload.signer
      batch.signedMatrixVersionId = batch.conclusion.matrixVersionId
      batch.version += 1
      delete state.releaseConflicts[batch.id]
      log(state, batch.id, '签字放行', action.payload.signer, `依据矩阵${batch.signedMatrixVersionId}签字放行${action.payload.note ? `：${action.payload.note}` : ''}`)
    },
    dismissReleaseConflict(state, action: PayloadAction<{ batchId: string }>) {
      delete state.releaseConflicts[action.payload.batchId]
    },
    /** 另一终端（标签页）持久化的新状态，整树采纳以实现跨终端同步 */
    adoptExternalState(_state, action: PayloadAction<PersistedState>) {
      return migrateState(action.payload)
    },
    resetDemo() {
      return seedState()
    }
  }
})

export const {
  setBatchFilter, setBatchStatus, setSelectedBatch, updateProcessStep, updateBatchStatus,
  addMonitoringReading, createDeviation, saveInvestigation, reviewDeviation,
  signRelease, dismissReleaseConflict, adoptExternalState, resetDemo
} = slice.actions
export type { HaccpState, PersistedState }
export { STORAGE_KEY, migrateState, seedState }
export default slice.reducer
