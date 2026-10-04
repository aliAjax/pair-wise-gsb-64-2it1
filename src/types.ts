export type BatchStatus = '待投产' | '生产中' | '待复核' | '可放行' | '隔离中' | '已放行' | '已报废'
export type DeviationStatus = '待调查' | '调查中' | '待复核' | '已关闭'
export type DecisionType = '返工' | '报废' | '让步接收'
export type ConclusionOutcome = '待补录' | '偏差冻结' | '待确认' | '符合放行' | '不符合'

export interface ProcessStep {
  id: string
  name: string
  equipment: string
  hazard: string
  controlPoint: string
  limit: string
  frequency: string
  correctiveAction: string
}

/** 控制矩阵的不可变版本快照，是监测判定、偏差处置与放行结论共用的生效依据 */
export interface MatrixVersion {
  id: string
  version: number
  publishedAt: string
  publishedBy: string
  note: string
  steps: ProcessStep[]
}

export interface MonitoringValue {
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
  /** 客户端生成的幂等键，重复补传凭它去重 */
  submissionId: string
  submittedAt: string
}

/** 放行结论，始终依据 matrixVersionId 指向的矩阵版本计算 */
export interface ReleaseConclusion {
  outcome: ConclusionOutcome
  reasons: string[]
  matrixVersionId: string
  computedAt: string
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
  /** 投产时钉住的矩阵版本；未投产为 null，跟随当前矩阵 */
  matrixVersionId: string | null
  conclusion: ReleaseConclusion | null
  signedAt?: string
  signedBy?: string
  /** 签字时使用的依据版本，已签字批次永远按它展示 */
  signedMatrixVersionId?: string
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
  /** 触发偏差的读数幂等键，防止重复补传重复开偏差 */
  sourceSubmissionId?: string
  closedAt?: string
  /** 同一控制点后续合格读数确认的时间与来源 */
  confirmedAt?: string
  confirmationSubmissionId?: string
}

/** 后到的放行提交：保留填值并提示冲突 */
export interface ReleaseConflict {
  batchId: string
  signer: string
  note: string
  attemptedAt: string
  baseVersion: number
  currentVersion: number
}

export interface AuditEntry {
  id: string
  entity: string
  action: string
  operator: string
  detail: string
  createdAt: string
}
