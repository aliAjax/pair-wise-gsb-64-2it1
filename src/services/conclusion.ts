import type { Batch, Deviation, MatrixVersion, MonitoringValue, ProcessStep, ReleaseConclusion } from '../types'

/** 终态（已签字）批次：结论冻结，继续按签字时的依据展示 */
export const TERMINAL_STATUSES: Array<Batch['status']> = ['已放行', '已报废']

export function isTerminal(batch: Pick<Batch, 'status'>): boolean {
  return TERMINAL_STATUSES.includes(batch.status)
}

/** 解析关键限值文本并判定读数是否合格，支持 ≤/≥/区间/金属灵敏度等写法 */
export function evaluateLimit(limit: string, value: number): boolean {
  const le = limit.match(/≤\s*(\d+(?:\.\d+)?)/)
  if (le) return value <= Number(le[1])
  const ge = limit.match(/≥\s*(\d+(?:\.\d+)?)/)
  if (ge) return value >= Number(ge[1])
  const range = limit.match(/(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)/)
  if (range) return value >= Number(range[1]) && value <= Number(range[2])
  const fe = limit.match(/Fe\s*(\d+(?:\.\d+)?)/i)
  if (fe) return value <= Number(fe[1])
  const first = limit.match(/(\d+(?:\.\d+)?)/)
  return first ? value <= Number(first[1]) : true
}

/** 批次当前生效的矩阵版本：投产钉住的版本优先，未投产跟随当前矩阵 */
export function effectiveMatrixVersionId(batch: Pick<Batch, 'matrixVersionId'>, currentMatrixVersionId: string): string {
  return batch.matrixVersionId ?? currentMatrixVersionId
}

export function stepsOfVersion(versions: MatrixVersion[], versionId: string, fallback: ProcessStep[]): ProcessStep[] {
  return versions.find((item) => item.id === versionId)?.steps ?? fallback
}

/** 已关闭偏差是否覆盖了某条读数（关闭时间不早于读数记录时间，补录不再重新挑起） */
function coveredByClosedDeviation(deviations: Deviation[], reading: MonitoringValue): boolean {
  return deviations.some((item) => item.stepId === reading.stepId && item.status === '已关闭' && !!item.closedAt && item.closedAt >= reading.recordedAt)
}

/**
 * 放行结论：控制矩阵、监测读数、偏差处置共用同一份生效依据（steps 来自批次钉住的矩阵版本）。
 * 优先级：偏差冻结 > 不符合 > 待确认 > 待补录 > 符合放行。
 */
export function computeConclusion(
  batch: Pick<Batch, 'id' | 'monitoring'>,
  deviations: Deviation[],
  steps: ProcessStep[],
  matrixVersionId: string,
  now: string
): ReleaseConclusion {
  const batchDeviations = deviations.filter((item) => item.batchId === batch.id)
  const reasons: string[] = []
  let outcome: ReleaseConclusion['outcome'] = '符合放行'

  const open = batchDeviations.filter((item) => item.status !== '已关闭')
  if (open.length > 0) {
    outcome = '偏差冻结'
    reasons.push(`存在${open.length}项未关闭偏差（${open.map((item) => item.id).join('、')}），放行已冻结`)
  }

  const uncovered = batch.monitoring.filter((reading) => {
    const step = steps.find((item) => item.id === reading.stepId)
    if (!step || evaluateLimit(step.limit, reading.value)) return false
    return !coveredByClosedDeviation(batchDeviations, reading)
  })
  if (outcome === '符合放行' && uncovered.length > 0) {
    outcome = '不符合'
    reasons.push(uncovered.map((reading) => {
      const step = steps.find((item) => item.id === reading.stepId)
      return `${step?.controlPoint ?? reading.stepId}读数${reading.value}${reading.unit}超出限值${step?.limit ?? ''}`
    }).join('；'))
  }

  const unconfirmed = batchDeviations.filter((item) => item.status === '已关闭' && !item.confirmedAt)
  if (outcome === '符合放行' && unconfirmed.length > 0) {
    outcome = '待确认'
    reasons.push(unconfirmed.map((item) => {
      const step = steps.find((entry) => entry.id === item.stepId)
      return `偏差${item.id}已关闭，待控制点「${step?.controlPoint ?? item.stepId}」后续合格读数确认`
    }).join('；'))
  }

  const missing = steps.filter((step) => !batch.monitoring.some((reading) => reading.stepId === step.id))
  if (outcome === '符合放行' && missing.length > 0) {
    outcome = '待补录'
    reasons.push(`缺少监测读数：${missing.map((item) => item.controlPoint).join('、')}`)
  }

  if (reasons.length === 0) reasons.push(`全部控制点读数符合矩阵${matrixVersionId}限值，无未关闭偏差`)
  return { outcome, reasons, matrixVersionId, computedAt: now }
}
