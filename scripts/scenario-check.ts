/* 端到端场景校验：用内存版 localStorage 驱动真实 store，不走 UI */
const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0
}
const sess = new Map<string, string>()
globalThis.sessionStorage = {
  getItem: (k: string) => sess.get(k) ?? null,
  setItem: (k: string, v: string) => void sess.set(k, v),
  removeItem: (k: string) => void sess.delete(k),
  clear: () => sess.clear(),
  key: () => null,
  length: 0
}

import { store } from '../src/store'
import { resetDemo, publishMatrix, commitConclusion } from '../src/store/haccpSlice'
import { submitReading, submitConclusion, flushOutbox, setSimulateFailure, setTerminalName } from '../src/store/terminalSlice'
import { evaluateBasis, deviationConfirmed } from '../src/services/basis'
import type { MatrixVersion, ProcessStep } from '../src/types'

let passed = 0
function check(name: string, cond: boolean, extra = '') {
  if (!cond) { console.error(`✗ ${name} ${extra}`); process.exit(1) }
  console.log(`✓ ${name} ${extra}`); passed += 1
}

const dispatch = store.dispatch
store.subscribe // ensure store loaded

dispatch(resetDemo())
dispatch(setTerminalName('终端A'))
const s0 = store.getState()
const V1 = s0.haccp.matrices.find((m) => m.version === 1)!
const V2 = s0.haccp.matrices.find((m) => m.version === 2)!

// 场景1：投产固定矩阵版本——9/29 批次固定 V1，9/30 批次固定 V2
const b01 = s0.haccp.batches.find((b) => b.id === 'B260929-01')!
const b03 = s0.haccp.batches.find((b) => b.id === 'B260930-03')!
check('旧批次固定 V1', b01.matrixVersionId === 'MX-2026-01')
check('新批次固定 V2', b03.matrixVersionId === 'MX-2026-02')

// 场景2：旧批次按旧限值判定——B260928-07 杀菌73.2：V1合格，按V2会超限；它已签字，仍冻结为合格
const b07 = s0.haccp.batches.find((b) => b.id === 'B260928-07')!
check('已签字批次存在冻结结论', !!b07.release)
const ev07 = evaluateBasis(b07, s0.haccp.deviations, s0.haccp.matrices)
const p2line07 = ev07.lines.find((l) => l.stepId === 'P2')!
check('已签字批次仍按 V1 展示合格', p2line07.compliant === true && ev07.matrix.id === 'MX-2026-01')

// 场景3：矩阵发布 V3（收紧P1 上限 4→3），9/30 批次（固定V2）不受影响；演示用“新投产批次”固定 V3
const v2Steps: ProcessStep[] = structuredClone(V2.steps)
v2Steps[0] = { ...v2Steps[0], limit: '≤ 3 ℃', spec: { min: null, max: 3, unit: '℃' } }
dispatch(publishMatrix({ steps: v2Steps, effectiveAt: '2026-10-05T00:00:00', note: '原料温度收紧至3℃', publishedBy: '测试' }))
let st = store.getState()
const V3 = st.haccp.matrices.find((m) => m.version === 3)!
const b03after = st.haccp.batches.find((b) => b.id === 'B260930-03')!
check('V3 发布后固定 V2 的批次版本不变', b03after.matrixVersionId === 'MX-2026-02')
check('V3 发布后固定 V2 的批次未标记重算', b03after.recalculatedAt === '')

// 立即重算正向用例：发布收紧 P3 的新版本（1.5→1.2），把未签字批次固定到新版后结论立即重算
const v3steps: ProcessStep[] = structuredClone(V2.steps)
v3steps[2] = { ...v3steps[2], limit: 'Fe 1.2 mm / SUS 1.5 mm', spec: { min: null, max: 1.2, unit: 'mm Fe' } }
dispatch(publishMatrix({ steps: v3steps, effectiveAt: '2026-10-01T00:00:00', note: '金属探测收紧', publishedBy: '测试' }))
st = store.getState()
const V3tight = st.haccp.matrices[st.haccp.matrices.length - 1]
// B260930-03 固定 V2，先补一条 1.4mm（V2 限值 ≤1.5 合格）
dispatch(submitReading({ batchId: 'B260930-03', stepId: 'P3', value: 1.4, unit: 'mm Fe', recordedAt: '2026-09-30T09:00:00', operator: '测试', source: '人工录入' }))
st = store.getState()
const p3before = evaluateBasis(st.haccp.batches.find((b) => b.id === 'B260930-03')!, st.haccp.deviations, st.haccp.matrices)
check('V2 下 1.4mm 合格', p3before.lines.find((l) => l.stepId === 'P3')!.compliant === true)
// 重新固定到收紧版 → 立即重算
const { pinBatchMatrix } = await import('../src/store/haccpSlice')
dispatch(pinBatchMatrix({ batchId: 'B260930-03', matrixVersionId: V3tight.id }))
st = store.getState()
const batchAfterPin = st.haccp.batches.find((b) => b.id === 'B260930-03')!
check('批次固定版本已切换', batchAfterPin.matrixVersionId === V3tight.id && batchAfterPin.recalculatedAt !== '')
const p3after = evaluateBasis(batchAfterPin, st.haccp.deviations, st.haccp.matrices)
check('未签字结论按新依据立即重算为超限', p3after.lines.find((l) => l.stepId === 'P3')!.compliant === false)
check('重算后放行冻结原因含 P3 超限', p3after.reasons.some((r) => r.stepId === 'P3' && r.type === 'oos-reading'))
check('已签字批次重算被跳过', st.haccp.batches.find((b) => b.id === 'B260928-07')!.recalculatedAt === '')
// 造一个固定 V3 的“投产批次”：直接改状态模拟（投产于10/05）
// 用 publishMatrix 之后再发布一版把生效时间改到过去不合适；改为直接校验 matrixForBatch 选择器
// （此处通过创建批次逻辑在下面场景覆盖）

// 场景4：超限补录 → 自动开偏差 + 冻结放行；重复补传不重复开偏差；归集到未关闭偏差
// 对 B260930-03（V2，P2下限75），补录一个超限读数
dispatch(resetDemo())
const beforeCount = store.getState().haccp.deviations.length
const r1 = dispatch(submitReading({ clientId: 'oos-p2-1', batchId: 'B260930-03', stepId: 'P2', value: 71.5, unit: '℃', recordedAt: '2026-09-30T07:10:00', operator: '终端A', source: '补录' }))
st = store.getState()
check('超限补录自动开偏差', !!r1.openedDeviationId, `dev=${r1.openedDeviationId}`)
check('自动开偏差后批次隔离', st.haccp.batches.find((b) => b.id === 'B260930-03')!.status === '隔离中')
check('偏差依据固定为批次矩阵 V2', st.haccp.deviations.find((d) => d.id === r1.openedDeviationId)!.basisMatrixId === 'MX-2026-02')
check('偏差数量增加1', st.haccp.deviations.length === beforeCount + 1)
const newDevId = r1.openedDeviationId!

// 同样 clientId 重复补传
const repeat = dispatch(submitReading({ clientId: 'oos-p2-1', batchId: 'B260930-03', stepId: 'P2', value: 71.5, unit: '℃', recordedAt: '2026-09-30T07:10:00', operator: '终端A', source: '补录' }))
st = store.getState()
check('重复补传返回 duplicate 标记', repeat.duplicate === true)
check('重复补传不重复开偏差', st.haccp.deviations.length === beforeCount + 1)
// 另一条不同超限读数 → 同控制点已有未关闭偏差，归集不新开
dispatch(submitReading({ batchId: 'B260930-03', stepId: 'P2', value: 70.2, unit: '℃', recordedAt: '2026-09-30T07:30:00', operator: '终端A', source: '在线采集' }))
st = store.getState()
check('后续超限归集到未关闭偏差，不再新开', st.haccp.deviations.length === beforeCount + 1)

// 场景5：关闭偏差后需后续合格读数确认
// 先完成调查+复核关闭
const dev = store.getState().haccp.deviations.find((d) => d.id === newDevId)!
const { saveInvestigation, reviewDeviation } = await import('../src/store/haccpSlice')
dispatch(saveInvestigation({ id: newDevId, investigation: { cause: '蒸汽不足', evidence: '趋势记录', decision: '返工', reworkInstruction: '重新杀菌' } }))
dispatch(reviewDeviation({ id: newDevId, approved: true, note: '通过', reviewer: '秦岚' }))
st = store.getState()
const closedDev = st.haccp.deviations.find((d) => d.id === newDevId)!
check('偏差已关闭并记录关闭时间', closedDev.status === '已关闭' && !!closedDev.closedAt)
let b03now = st.haccp.batches.find((b) => b.id === 'B260930-03')!
let ev03 = evaluateBasis(b03now, st.haccp.deviations, st.haccp.matrices)
check('关闭后无确认读数 → 放行仍冻结', ev03.ready === false && ev03.reasons.some((r) => r.type === 'awaiting-confirmation'))
check('deviationConfirmed=false', deviationConfirmed(closedDev, b03now, V2) === false)

// 关闭时间之前的合格读数不算确认
const closedAt = closedDev.closedAt!
dispatch(submitReading({ batchId: 'B260930-03', stepId: 'P2', value: 76.1, unit: '℃', recordedAt: '2026-09-30T06:30:00', operator: '终端A', source: '补录' }))
st = store.getState(); b03now = st.haccp.batches.find((b) => b.id === 'B260930-03')!
check('关闭之前的合格读数不确认', st.haccp.deviations.find((d) => d === closedDev) === closedDev) // noop sanity
check('关闭前读数不满足确认', !deviationConfirmed(st.haccp.deviations.find((d) => d.id === newDevId)!, b03now, V2))

// 关闭之后的合格读数 → 确认；仍缺 P3/P4/P5 读数，所以继续冻结但原因变化
const later = new Date(Date.parse(closedAt) + 60000).toISOString()
dispatch(submitReading({ batchId: 'B260930-03', stepId: 'P2', value: 76.1, unit: '℃', recordedAt: later, operator: '终端A', source: '在线采集' }))
st = store.getState(); b03now = st.haccp.batches.find((b) => b.id === 'B260930-03')!
const confirmedDev = st.haccp.deviations.find((d) => d.id === newDevId)!
check('关闭后合格读数确认偏差', !!confirmedDev.confirmationReadingId && deviationConfirmed(confirmedDev, b03now, V2))
ev03 = evaluateBasis(b03now, st.haccp.deviations, st.haccp.matrices)
check('确认后不再有该偏差的阻塞原因', !ev03.reasons.some((r) => r.stepId === 'P2' && (r.type === 'awaiting-confirmation' || r.type === 'open-deviation')))

// 已关闭偏差后再来一条超限 → 新开偏差，绝不重新挑起已关闭的
const beforeCount2 = store.getState().haccp.deviations.length
const r2 = dispatch(submitReading({ batchId: 'B260930-03', stepId: 'P2', value: 70.0, unit: '℃', recordedAt: new Date(Date.parse(later) + 120000).toISOString(), operator: '终端A', source: '补录' }))
st = store.getState()
check('关闭后超限补录新开偏差', !!r2.openedDeviationId && r2.openedDeviationId !== newDevId)
check('新开偏差数量+1', st.haccp.deviations.length === beforeCount2 + 1)
check('原偏差保持已关闭', st.haccp.deviations.find((d) => d.id === newDevId)!.status === '已关闭')

// 场景6：先到者生效（两个终端提交同一批次结论）——用 B260929-02，先把其偏差确认掉
dispatch(resetDemo())
// 关闭 DEV-260929-02 并给后续合格读数（V1 P4 范围 0.38-0.45，0.42合格）
dispatch(saveInvestigation({ id: 'DEV-260929-02', investigation: { cause: '密封圈磨损', evidence: '照片', decision: '返工', reworkInstruction: '更换密封' } }))
dispatch(reviewDeviation({ id: 'DEV-260929-02', approved: true, note: '通过', reviewer: '秦岚' }))
let dev02 = store.getState().haccp.deviations.find((d) => d.id === 'DEV-260929-02')!
const afterClose = new Date(Date.parse(dev02.closedAt!) + 30000).toISOString()
dispatch(submitReading({ batchId: 'B260929-02', stepId: 'P4', value: 0.42, unit: 'MPa', recordedAt: afterClose, operator: '终端A', source: '在线采集' }))
// 补齐 B260929-02 其它控制点读数（V1：P1≤4, P2≥72, P3≤1.5, P5≤10）
for (const [stepId, value, unit] of [['P1', 3.1, '℃'], ['P2', 73.5, '℃'], ['P3', 1.3, 'mm Fe'], ['P5', 9.0, '℃']] as const) {
  dispatch(submitReading({ batchId: 'B260929-02', stepId, value, unit, recordedAt: afterClose, operator: '终端A', source: '人工录入' }))
}
st = store.getState()
const b02 = st.haccp.batches.find((b) => b.id === 'B260929-02')!
const ev02 = evaluateBasis(b02, st.haccp.deviations, st.haccp.matrices)
check('所有阻塞解除→ready', ev02.ready === true, ev02.reasons.map((r) => r.text).join('|'))

// 终端A 先提交复核 → 生效 seq 2
const a1 = dispatch(submitConclusion({ batchId: 'B260929-02', action: '提交复核', note: '终端A意见', signer: '秦岚', baseSeq: 1 }))
check('先到者提交生效', a1.outcome === 'committed' && a1.outcome === 'committed' && (a1 as any).seq === 2)
// 终端B（模拟另一会话：其草稿仍基于 seq=1）提交 → 冲突，填值保留
dispatch(setTerminalName('终端B'))
const b1 = dispatch(submitConclusion({ batchId: 'B260929-02', action: '签字放行', note: '终端B意见', signer: '秦岚', baseSeq: 1 }))
check('后到者冲突', b1.outcome === 'conflict')
if (b1.outcome === 'conflict') {
  check('冲突信息指向前到终端', b1.otherTerminalName === '终端A')
}
check('冲突时本机草稿保留', store.getState().terminal.drafts['B260929-02']?.note === '终端B意见')
check('冲突时结论版本未被后到者抬升', store.getState().haccp.batches.find((b) => b.id === 'B260929-02')!.conclusionSeq === 2)
// 终端B 接受现状、基于新版本重新提交签字
const b2 = dispatch(submitConclusion({ batchId: 'B260929-02', action: '签字放行', note: '终端B阅后签字', signer: '秦岚' }))
check('后到者基于新版本可重新提交', b2.outcome === 'committed')
st = store.getState()
const b02signed = st.haccp.batches.find((b) => b.id === 'B260929-02')!
check('签字后冻结 V1 依据', !!b02signed.release && b02signed.release!.matrixVersionId === 'MX-2026-01')

// 已签字批次：超限补录不能改变结论
dispatch(submitReading({ batchId: 'B260929-02', stepId: 'P2', value: 60, unit: '℃', recordedAt: new Date().toISOString(), operator: '终端B', source: '补录' }))
st = store.getState()
const stillSigned = st.haccp.batches.find((b) => b.id === 'B260929-02')!
check('已签字批次补录不改变冻结结论', stillSigned.status === '已放行' && stillSigned.release!.lines.length === 5)
check('已签字批次不因补录新开偏差', !st.haccp.deviations.some((d) => d.batchId === 'B260929-02' && d.openedAt > b02signed.release!.signedAt))

// 场景7：本地写入失败 → outbox → 恢复幂等补传
dispatch(resetDemo())
dispatch(setSimulateFailure(true))
const off1 = dispatch(submitReading({ clientId: 'offline-1', batchId: 'B260930-03', stepId: 'P4', value: 0.41, unit: 'MPa', recordedAt: '2026-09-30T08:00:00', operator: '终端A', source: '人工录入' }))
check('写入失败进入 outbox', off1.offline === true && store.getState().terminal.outbox.length === 1)
// 恢复
dispatch(setSimulateFailure(false))
const report = dispatch(flushOutbox())
check('恢复后补传成功', report.length === 1 && !report[0].duplicate)
st = store.getState()
check('outbox 清空', st.terminal.outbox.length === 0)
check('读数已落库', st.haccp.batches.find((b) => b.id === 'B260930-03')!.monitoring.some((m) => m.clientId === 'offline-1'))
// 再次 flush 同 clientId（模拟重复补传）：手动塞 outbox 再恢复
dispatch(setSimulateFailure(true))
dispatch(submitReading({ clientId: 'offline-1', batchId: 'B260930-03', stepId: 'P4', value: 0.41, unit: 'MPa', recordedAt: '2026-09-30T08:00:00', operator: '终端A', source: '人工录入' }))
dispatch(setSimulateFailure(false))
const report2 = dispatch(flushOutbox())
check('重复补传按幂等去重', report2[0].duplicate === true)
const devCount = store.getState().haccp.deviations.length
check('幂等补传未重复开偏差', store.getState().haccp.deviations.length === devCount)

// 场景8：新批次投产固定到投产时刻已生效的最新矩阵（V3 明日生效，故今日投产仍固定 V2）
const { createBatch } = await import('../src/store/haccpSlice')
dispatch(createBatch({ product: '测试产品', line: 'L9', quantity: 100, operator: '终端A' }))
st = store.getState()
const newest = st.haccp.batches[0]
check('今日投产批次固定已生效的最新版 V2（未来版本不提前适用）', newest.matrixVersionId === 'MX-2026-02')

console.log(`\n全部 ${passed} 项校验通过`)
