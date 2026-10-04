import type { Batch, ConclusionLine, Deviation, MatrixVersion, MonitoringValue, ProcessStep } from '../types'

/**
 * 生效依据统一入口：控制矩阵、批次监测、偏差处置、放行结论都只从这里取判定结果。
 * 规则：
 * 1) 批次投产时刻固定矩阵版本（batch.matrixVersionId），之后矩阵改版不影响该批次；
 * 2) 已签字批次直接展示签字时冻结的结论，不再重算；
 * 3) 未签字批次的结论每次都依据其固定版本重算（矩阵更新后立即重算）；
 * 4) 偏差关闭后，还需要同一控制点后续（关闭之后）的合格读数确认。
 */

export function matrixLabel(matrix: MatrixVersion): string {
  return `V${matrix.version}（${matrix.effectiveAt.slice(0, 10)} 生效）`
}

export function matrixById(matrices: MatrixVersion[], id: string): MatrixVersion {
  return matrices.find((item) => item.id === id) ?? matrices[0]
}

/** 批次投产时刻生效的矩阵版本：effectiveAt 不晚于投产时间的最后一版 */
export function matrixForBatch(matrices: MatrixVersion[], producedAt: string): MatrixVersion {
  const ordered = [...matrices].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
  return ordered.filter((item) => item.effectiveAt <= producedAt).at(-1) ?? ordered[0]
}

export function stepById(matrix: MatrixVersion, stepId: string): ProcessStep | undefined {
  return matrix.steps.find((item) => item.id === stepId)
}

export function isCompliant(value: number, spec: ProcessStep['spec']): boolean {
  if (spec.min !== null && value < spec.min) return false
  if (spec.max !== null && value > spec.max) return false
  return true
}

/** 最新一条读数按批次固定矩阵版本判定是否合格 */
export function readingCompliant(reading: MonitoringValue, matrix: MatrixVersion): boolean {
  const step = stepById(matrix, reading.stepId)
  return step ? isCompliant(reading.value, step.spec) : true
}

export function latestReadings(monitoring: MonitoringValue[]): Map<string, MonitoringValue> {
  const map = new Map<string, MonitoringValue>()
  for (const reading of monitoring) {
    const current = map.get(reading.stepId)
    if (!current || reading.recordedAt >= current.recordedAt) map.set(reading.stepId, reading)
  }
  return map
}

export type BlockingReasonType =
  | 'open-deviation'
  | 'awaiting-confirmation'
  | 'oos-reading'
  | 'missing-reading'
  | 'signed-frozen'

export interface BlockingReason {
  type: BlockingReasonType
  stepId?: string
  text: string
}

export interface BasisEvaluation {
  matrix: MatrixVersion
  lines: ConclusionLine[]
  reasons: BlockingReason[]
  ready: boolean
  /** 每个已关闭偏差是否已取得同一控制点后续合格读数确认 */
  confirmations: Record<string, boolean>
}

/**
 * 偏差关闭确认：存在一条与偏差同控制点、记录时间晚于关闭时间、按批次固定版本判定合格的读数。
 */
export function deviationConfirmed(deviation: Deviation, batch: Batch, matrix: MatrixVersion): boolean {
  if (deviation.status !== '已关闭' || !deviation.closedAt) return false
  return batch.monitoring.some((reading) => {
    if (reading.stepId !== deviation.stepId) return false
    if (reading.recordedAt < deviation.closedAt!) return false
    return readingCompliant(reading, matrix)
  })
}

export function evaluationForBatch(batch: Batch, deviations: Deviation[], matrices: MatrixVersion[]): BasisEvaluation {
  const matrix = matrixById(matrices, batch.matrixVersionId)
  const lines: ConclusionLine[] = []
  const reasons: BlockingReason[] = []
  const latest = latestReadings(batch.monitoring)
  const batchDeviations = deviations.filter((item) => item.batchId === batch.id)
  const confirmations: Record<string, boolean> = {}

  for (const step of matrix.steps) {
    const reading = latest.get(step.id) ?? null
    const compliant = reading ? isCompliant(reading.value, step.spec) : null
    lines.push({
      stepId: step.id, controlPoint: step.controlPoint, limit: step.limit,
      value: reading?.value ?? null, unit: step.spec.unit, compliant,
      readingId: reading?.id ?? null, source: reading?.source ?? null
    })
    if (!reading) {
      reasons.push({ type: 'missing-reading', stepId: step.id, text: `${step.name}（${step.controlPoint}）尚无监测读数` })
    } else if (compliant === false) {
      reasons.push({ type: 'oos-reading', stepId: step.id, text: `${step.controlPoint}最新读数 ${reading.value}${step.spec.unit} 超出${matrixLabel(matrix)}限值 ${step.limit}` })
    }
  }

  for (const deviation of batchDeviations) {
    if (deviation.status !== '已关闭') {
      reasons.push({ type: 'open-deviation', stepId: deviation.stepId, text: `偏差 ${deviation.id}（${deviation.title}）处于${deviation.status}，放行已冻结` })
    } else {
      const ok = deviationConfirmed(deviation, batch, matrix)
      confirmations[deviation.id] = ok
      if (!ok) {
        const step = stepById(matrix, deviation.stepId)
        reasons.push({ type: 'awaiting-confirmation', stepId: deviation.stepId, text: `偏差 ${deviation.id} 已关闭，等待${step?.controlPoint ?? deviation.stepId}后续合格读数确认` })
      }
    }
  }

  return { matrix, lines, reasons, ready: reasons.length === 0, confirmations }
}

/** 签字批次：永远返回冻结时的依据与结论行 */
export function frozenEvaluation(batch: Batch, matrices: MatrixVersion[]): BasisEvaluation {
  const release = batch.release
  const matrix = release ? matrixById(matrices, release.matrixVersionId) : matrixById(matrices, batch.matrixVersionId)
  return {
    matrix,
    lines: release?.lines ?? [],
    reasons: release ? [{ type: 'signed-frozen', text: '批次已签字，结论与依据已冻结，继续按原依据展示' }] : [],
    ready: false,
    confirmations: {}
  }
}

/** 四模块共用的判定入口：已签字用冻结结论，未签字实时重算 */
export function evaluateBasis(batch: Batch, deviations: Deviation[], matrices: MatrixVersion[]): BasisEvaluation {
  return batch.release ? frozenEvaluation(batch, matrices) : evaluationForBatch(batch, deviations, matrices)
}
