import { describe, expect, it } from 'vitest'
import reducer, {
  addMonitoringReading, migrateState, seedState, signRelease, updateBatchStatus, updateProcessStep, reviewDeviation
} from './haccpSlice'

const readingPayload = (batchId: string, stepId: string, value: number, recordedAt: string, submissionId: string) =>
  ({ batchId, stepId, value, unit: '℃', operator: '测试员', recordedAt, submissionId })

describe('生效依据：矩阵版本固定与重算', () => {
  it('批次投产后固定矩阵版本', () => {
    let state = seedState()
    state = reducer(state, updateBatchStatus({ id: 'B261004-01', status: '生产中' }))
    const batch = state.batches.find((item) => item.id === 'B261004-01')!
    expect(batch.status).toBe('生产中')
    expect(batch.matrixVersionId).toBe('MV-1')
  })

  it('矩阵更新后：未签字结论立即重算，已投产批次仍按投产时版本判定', () => {
    let state = seedState()
    const p1 = state.processSteps.find((item) => item.id === 'P1')!
    const before = state.batches.find((item) => item.id === 'B260929-03')!
    expect(before.conclusion?.outcome).toBe('待确认')
    // 收紧原料温度限值：3.1℃ 在新版超限，但 B260929-03 投产时钉住 MV-1
    state = reducer(state, updateProcessStep({ ...p1, limit: '≤ 3 ℃' }))
    expect(state.currentMatrixVersionId).toBe('MV-2')
    const pinned = state.batches.find((item) => item.id === 'B260929-03')!
    expect(pinned.conclusion?.outcome).toBe('待确认')
    expect(pinned.conclusion?.matrixVersionId).toBe('MV-1')
    // 未投产批次跟随当前矩阵，结论依据立即切换
    const pending = state.batches.find((item) => item.id === 'B261004-01')!
    expect(pending.conclusion?.matrixVersionId).toBe('MV-2')
  })

  it('已签字批次不按新限值重算，继续按签字依据展示', () => {
    let state = seedState()
    const signed = state.batches.find((item) => item.id === 'B260928-07')!
    const computedAt = signed.conclusion?.computedAt
    const p1 = state.processSteps.find((item) => item.id === 'P1')!
    state = reducer(state, updateProcessStep({ ...p1, limit: '≤ 2 ℃' }))
    const after = state.batches.find((item) => item.id === 'B260928-07')!
    expect(after.signedMatrixVersionId).toBe('MV-1')
    expect(after.conclusion?.matrixVersionId).toBe('MV-1')
    expect(after.conclusion?.computedAt).toBe(computedAt)
    expect(after.conclusion?.outcome).toBe('符合放行')
  })
})

describe('补录读数：偏差联动与幂等', () => {
  it('超限补录先开偏差并冻结放行', () => {
    let state = seedState()
    state = reducer(state, addMonitoringReading(readingPayload('B260929-02', 'P1', 5.2, '2026-10-04T08:00:00', 'SUB-1')))
    const batch = state.batches.find((item) => item.id === 'B260929-02')!
    const deviation = state.deviations.find((item) => item.sourceSubmissionId === 'SUB-1')
    expect(deviation).toBeDefined()
    expect(deviation?.status).toBe('待调查')
    expect(batch.status).toBe('隔离中')
    expect(batch.conclusion?.outcome).toBe('偏差冻结')
  })

  it('重复补传同一 submissionId 不重复开偏差、不重复记录', () => {
    let state = seedState()
    state = reducer(state, addMonitoringReading(readingPayload('B260929-02', 'P1', 5.2, '2026-10-04T08:00:00', 'SUB-2')))
    const deviationsAfterFirst = state.deviations.length
    const versionAfterFirst = state.batches.find((item) => item.id === 'B260929-02')!.version
    state = reducer(state, addMonitoringReading(readingPayload('B260929-02', 'P1', 5.2, '2026-10-04T08:00:00', 'SUB-2')))
    const batch = state.batches.find((item) => item.id === 'B260929-02')!
    expect(state.deviations.length).toBe(deviationsAfterFirst)
    expect(batch.monitoring.filter((item) => item.submissionId === 'SUB-2').length).toBe(1)
    expect(batch.version).toBe(versionAfterFirst)
  })

  it('同一控制点已有未关闭偏差时不重复开偏差', () => {
    let state = seedState()
    const before = state.deviations.filter((item) => item.batchId === 'B260929-01' && item.stepId === 'P2').length
    state = reducer(state, addMonitoringReading(readingPayload('B260929-01', 'P2', 69.0, '2026-10-04T08:00:00', 'SUB-3')))
    const after = state.deviations.filter((item) => item.batchId === 'B260929-01' && item.stepId === 'P2').length
    expect(after).toBe(before)
  })

  it('已被已关闭偏差覆盖的历史补录不再重新挑起偏差', () => {
    let state = seedState()
    // DEV-260929-03 于 2026-09-29T14:20:00 关闭，补录更早时刻的超限读数
    state = reducer(state, addMonitoringReading(readingPayload('B260929-03', 'P5', 13.5, '2026-09-29T12:30:00', 'SUB-4')))
    const batch = state.batches.find((item) => item.id === 'B260929-03')!
    expect(state.deviations.some((item) => item.sourceSubmissionId === 'SUB-4')).toBe(false)
    expect(batch.conclusion?.outcome).toBe('待确认')
  })

  it('偏差关闭后需同一控制点后续合格读数确认才放行', () => {
    let state = seedState()
    const batchBefore = state.batches.find((item) => item.id === 'B260929-03')!
    expect(batchBefore.conclusion?.outcome).toBe('待确认')
    // 关闭时间之后的合格读数 → 确认偏差，结论转为符合放行
    state = reducer(state, addMonitoringReading(readingPayload('B260929-03', 'P5', 8.4, '2026-10-04T09:00:00', 'SUB-5')))
    const deviation = state.deviations.find((item) => item.id === 'DEV-260929-03')!
    expect(deviation.confirmedAt).toBeDefined()
    expect(deviation.confirmationSubmissionId).toBe('SUB-5')
    const batch = state.batches.find((item) => item.id === 'B260929-03')!
    expect(batch.conclusion?.outcome).toBe('符合放行')
    // 确认前不允许提交可放行，确认后可以
    state = reducer(state, updateBatchStatus({ id: 'B260929-03', status: '可放行' }))
    expect(state.batches.find((item) => item.id === 'B260929-03')!.status).toBe('可放行')
  })

  it('偏差关闭前的历史读数不能充当确认读数', () => {
    let state = seedState()
    state = reducer(state, addMonitoringReading(readingPayload('B260929-03', 'P5', 8.4, '2026-09-29T13:00:00', 'SUB-6')))
    const deviation = state.deviations.find((item) => item.id === 'DEV-260929-03')!
    expect(deviation.confirmedAt).toBeUndefined()
  })
})

describe('放行结论提交：先到者生效', () => {
  const prepareReleasable = () => {
    let state = seedState()
    state = reducer(state, addMonitoringReading(readingPayload('B260929-03', 'P5', 8.4, '2026-10-04T09:00:00', 'SUB-7')))
    state = reducer(state, updateBatchStatus({ id: 'B260929-03', status: '可放行' }))
    return state
  }

  it('版本一致的提交生效并完成签字', () => {
    let state = prepareReleasable()
    const batch = state.batches.find((item) => item.id === 'B260929-03')!
    state = reducer(state, signRelease({ batchId: batch.id, expectedVersion: batch.version, signer: '质量负责人 秦岚', note: '放行' }))
    const after = state.batches.find((item) => item.id === 'B260929-03')!
    expect(after.status).toBe('已放行')
    expect(after.signedMatrixVersionId).toBe('MV-1')
    expect(after.signedBy).toBe('质量负责人 秦岚')
  })

  it('版本过期的提交被驳回：保留填值并记录冲突，重新提交后生效', () => {
    let state = prepareReleasable()
    const batch = state.batches.find((item) => item.id === 'B260929-03')!
    // 另一终端先行提交，版本前进
    state = reducer(state, signRelease({ batchId: batch.id, expectedVersion: batch.version, signer: '终端A', note: '' }))
    const current = state.batches.find((item) => item.id === 'B260929-03')!
    expect(current.status).toBe('已放行')
    // 本终端仍基于旧版本提交 → 冲突，填值保留
    state = reducer(state, signRelease({ batchId: batch.id, expectedVersion: batch.version, signer: '终端B', note: '我的备注' }))
    const conflict = state.releaseConflicts[batch.id]
    expect(conflict).toBeDefined()
    expect(conflict.signer).toBe('终端B')
    expect(conflict.note).toBe('我的备注')
    expect(conflict.currentVersion).toBe(current.version)
  })

  it('结论不符合放行时禁止签字', () => {
    let state = seedState()
    const batch = state.batches.find((item) => item.id === 'B260929-01')!
    state = reducer(state, signRelease({ batchId: batch.id, expectedVersion: batch.version, signer: '质量负责人', note: '' }))
    expect(state.batches.find((item) => item.id === 'B260929-01')!.status).toBe('隔离中')
  })
})

describe('偏差复核关闭', () => {
  it('复核通过后记录关闭时间，批次等待确认读数', () => {
    let state = seedState()
    state = reducer(state, reviewDeviation({ id: 'DEV-260929-02', approved: true, note: '证据充分', reviewer: '质量负责人 秦岚' }))
    const deviation = state.deviations.find((item) => item.id === 'DEV-260929-02')!
    expect(deviation.status).toBe('已关闭')
    expect(deviation.closedAt).toBeDefined()
    const batch = state.batches.find((item) => item.id === 'B260929-02')!
    expect(batch.conclusion?.outcome).toBe('待确认')
  })
})

describe('旧版本持久化数据迁移', () => {
  it('旧矩阵固化为历史版本，既有批次与已签字批次以其为依据', () => {
    const fresh = seedState()
    const editedSteps = fresh.processSteps.map((step) => step.id === 'P1' ? { ...step, limit: '≤ 5 ℃' } : step)
    // 模拟旧版本持久化：无矩阵版本、读数无幂等键
    const legacyRaw = JSON.parse(JSON.stringify({
      ...fresh,
      processSteps: editedSteps,
      matrixVersions: undefined,
      currentMatrixVersionId: undefined,
      releaseConflicts: undefined,
      batches: fresh.batches.map((batch) => ({
        ...batch,
        matrixVersionId: undefined,
        signedMatrixVersionId: undefined,
        conclusion: undefined,
        monitoring: batch.monitoring.map(({ stepId, value, unit, recordedAt, operator }) => ({ stepId, value, unit, recordedAt, operator }))
      }))
    }))
    const state = migrateState(legacyRaw)
    expect(state.currentMatrixVersionId).toBe('MV-LEGACY')
    const signed = state.batches.find((item) => item.id === 'B260928-07')!
    expect(signed.signedMatrixVersionId).toBe('MV-LEGACY')
    expect(signed.conclusion?.matrixVersionId).toBe('MV-LEGACY')
    const pinned = state.batches.find((item) => item.id === 'B260929-03')!
    expect(pinned.matrixVersionId).toBe('MV-LEGACY')
    expect(pinned.monitoring.every((reading) => reading.submissionId)).toBe(true)
    // 旧矩阵限值 ≤5℃ 下 3.1℃ 合格，结论不按种子矩阵 ≤4℃ 误判
    expect(state.matrixVersions.find((item) => item.id === 'MV-LEGACY')?.steps.find((step) => step.id === 'P1')?.limit).toBe('≤ 5 ℃')
  })
})
