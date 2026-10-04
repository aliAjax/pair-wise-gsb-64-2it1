import { describe, expect, it } from 'vitest'
import { computeConclusion, evaluateLimit } from './conclusion'
import { processSteps } from '../data/seed'
import type { Deviation, MonitoringValue } from '../types'

const reading = (stepId: string, value: number, recordedAt = '2026-10-04T08:00:00'): MonitoringValue =>
  ({ stepId, value, unit: '℃', recordedAt, operator: '测试', submissionId: `T-${stepId}-${value}`, submittedAt: recordedAt })

const deviation = (overrides: Partial<Deviation>): Deviation => ({
  id: 'DEV-T1', batchId: 'B-T1', stepId: 'P2', title: '测试偏差', severity: '一般', status: '已关闭',
  owner: '质量工程组', openedAt: '2026-10-04T07:00:00', dueDate: '2026-10-05',
  investigation: { cause: 'c', evidence: 'e', decision: '返工', reworkInstruction: 'r' },
  reviewNote: '', reviewer: '', version: 1, ...overrides
})

const fullMonitoring = () => processSteps.map((step, index) => reading(step.id, [3.0, 73.5, 1.2, 0.41, 8.0][index]))

describe('evaluateLimit 限值解析', () => {
  it('支持 ≤、≥、区间与金属灵敏度写法', () => {
    expect(evaluateLimit('≤ 4 ℃', 3.4)).toBe(true)
    expect(evaluateLimit('≤ 4 ℃', 4.1)).toBe(false)
    expect(evaluateLimit('≥ 72 ℃ / 15 s', 72)).toBe(true)
    expect(evaluateLimit('≥ 72 ℃ / 15 s', 70.8)).toBe(false)
    expect(evaluateLimit('0.38-0.45 MPa', 0.41)).toBe(true)
    expect(evaluateLimit('0.38-0.45 MPa', 0.36)).toBe(false)
    expect(evaluateLimit('Fe 1.5 mm / SUS 2.0 mm', 1.5)).toBe(true)
    expect(evaluateLimit('Fe 1.5 mm / SUS 2.0 mm', 1.6)).toBe(false)
  })
})

describe('computeConclusion 放行结论', () => {
  const batch = { id: 'B-T1', monitoring: fullMonitoring() }

  it('全部合格且无偏差 → 符合放行', () => {
    const result = computeConclusion(batch, [], processSteps, 'MV-1', '2026-10-04T09:00:00')
    expect(result.outcome).toBe('符合放行')
    expect(result.matrixVersionId).toBe('MV-1')
  })

  it('缺少读数 → 待补录', () => {
    const result = computeConclusion({ id: 'B-T1', monitoring: fullMonitoring().slice(0, 3) }, [], processSteps, 'MV-1', '2026-10-04T09:00:00')
    expect(result.outcome).toBe('待补录')
  })

  it('未关闭偏差 → 偏差冻结', () => {
    const result = computeConclusion(batch, [deviation({ status: '调查中' })], processSteps, 'MV-1', '2026-10-04T09:00:00')
    expect(result.outcome).toBe('偏差冻结')
  })

  it('已关闭未确认偏差 → 待确认', () => {
    const result = computeConclusion(batch, [deviation({ closedAt: '2026-10-04T08:30:00' })], processSteps, 'MV-1', '2026-10-04T09:00:00')
    expect(result.outcome).toBe('待确认')
  })

  it('超限读数被已关闭偏差覆盖 → 不判不符合', () => {
    const monitoring = fullMonitoring()
    monitoring[1] = reading('P2', 70.0, '2026-10-04T07:30:00')
    const dev = deviation({ stepId: 'P2', closedAt: '2026-10-04T08:00:00', confirmedAt: '2026-10-04T08:40:00' })
    const result = computeConclusion({ id: 'B-T1', monitoring }, [dev], processSteps, 'MV-1', '2026-10-04T09:00:00')
    expect(result.outcome).toBe('符合放行')
  })

  it('超限读数未被覆盖 → 不符合', () => {
    const monitoring = fullMonitoring()
    monitoring[1] = reading('P2', 70.0, '2026-10-04T08:50:00')
    const dev = deviation({ stepId: 'P2', closedAt: '2026-10-04T08:00:00', confirmedAt: '2026-10-04T08:40:00' })
    const result = computeConclusion({ id: 'B-T1', monitoring }, [dev], processSteps, 'MV-1', '2026-10-04T09:00:00')
    expect(result.outcome).toBe('不符合')
  })
})
