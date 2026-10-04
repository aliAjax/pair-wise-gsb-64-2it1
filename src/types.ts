export type BatchStatus = '生产中' | '待复核' | '可放行' | '隔离中' | '已放行' | '已报废'
export type DeviationStatus = '待调查' | '调查中' | '待复核' | '已关闭'
export type DecisionType = '返工' | '报废' | '让步接收'
export type MonitoringSource = '在线采集' | '人工录入' | '补录'

/** 可计算的关键限值（生效依据的最小单元） */
export interface LimitSpec {
  min: number | null
  max: number | null
  unit: string
}

export interface ProcessStep {
  id: string
  name: string
  equipment: string
  hazard: string
  controlPoint: string
  limit: string
  spec: LimitSpec
  frequency: string
  correctiveAction: string
}

/** 控制矩阵版本：控制矩阵、批次监测、偏差处置、放行结论共用的生效依据 */
export interface MatrixVersion {
  id: string
  version: number
  effectiveAt: string
  publishedAt: string
  publishedBy: string
  note: string
  steps: ProcessStep[]
}

export interface MonitoringValue {
  id: string
  /** 幂等键：终端生成，重复补传据此去重 */
  clientId: string
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
  source: MonitoringSource
  backfilled: boolean
}

/** 放行结论中每一个控制点的判定行（签字时按此冻结） */
export interface ConclusionLine {
  stepId: string
  controlPoint: string
  limit: string
  value: number | null
  unit: string
  compliant: boolean | null
  readingId: string | null
  source: MonitoringSource | null
}

export interface SignedRelease {
  signedAt: string
  signer: string
  terminalId: string
  terminalName: string
  note: string
  matrixVersionId: string
  matrixLabel: string
  seq: number
  lines: ConclusionLine[]
}

export interface Batch {
  id: string
  product: string
  line: string
  quantity: number
  producedAt: string
  status: BatchStatus
  isolationScope: string
  monitoring: MonitoringValue[]
  version: number
  /** 投产时刻固定的矩阵版本，之后改版不影响本批次判定 */
  matrixVersionId: string
  /** 放行结论版本号：只有“结论提交/签字”才递增，用于两终端先到者生效判定 */
  conclusionSeq: number
  /** 矩阵更新后未签字结论最近一次重算时间 */
  recalculatedAt: string
  lastConclusion?: { terminalId: string; terminalName: string; action: '提交复核' | '签字放行'; at: string; note: string }
  /** 已签字批次的冻结依据，之后只读展示 */
  release?: SignedRelease
}

export interface Investigation {
  cause: string
  evidence: string
  decision: DecisionType
  reworkInstruction: string
}

export interface Deviation {
  id: string
  batchId: string
  stepId: string
  title: string
  severity: '一般' | '重大'
  status: DeviationStatus
  owner: string
  openedAt: string
  dueDate: string
  investigation: Investigation
  reviewNote: string
  reviewer: string
  version: number
  /** 开偏差时依据的矩阵版本与限值文本，同样固定 */
  basisMatrixId: string
  basisLimit: string
  /** 由哪条超限读数自动开出（幂等去重用） */
  sourceReadingId?: string
  autoOpened?: boolean
  closedAt?: string
  /** 关闭后同一控制点的后续合格确认读数 */
  confirmationReadingId?: string
}

export interface AuditEntry {
  id: string
  entity: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export interface ReadingInput {
  clientId: string
  batchId: string
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
  source: MonitoringSource
}

/** 本地写入失败后挂起的监测点，恢复时按 clientId 幂等补传 */
export interface OutboxEntry extends ReadingInput {
  failedAt: string
  attempts: number
}

export interface ConclusionDraft {
  batchId: string
  note: string
  signer: string
  /** 草稿所基于的结论版本，冲突判定后仍保留填值 */
  baseSeq: number
  updatedAt: string
}

export interface ConflictNotice {
  batchId: string
  baseSeq: number
  currentSeq: number
  otherTerminalName: string
  action: string
  at: string
}

export interface TerminalState {
  terminalId: string
  terminalName: string
  simulateFailure: boolean
  outbox: OutboxEntry[]
  drafts: Record<string, ConclusionDraft>
  conflict: ConflictNotice | null
}
