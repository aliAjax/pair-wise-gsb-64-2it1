import type { AuditEntry, Batch, Deviation, MatrixVersion, ProcessStep } from '../types'

/**
 * 生效依据（控制矩阵）历史版本：
 * V1 自 2026-09-01 生效，是 9/28、9/29 批次投产时固定的依据；
 * V2 自 2026-09-30 生效（改版：杀菌 72→75℃、封口 0.38-0.45→0.40-0.46MPa、冷却 10→8℃）。
 * 批次在投产时刻固定矩阵版本：旧批次永远按 V1 判定，V2 只影响 9/30 后投产的批次。
 */
function steps(overrides: Record<string, Partial<ProcessStep>>): ProcessStep[] {
  const base: Array<Omit<ProcessStep, 'spec'> & { spec: ProcessStep['spec'] }> = [
    { id: 'P1', name: '原料验收', equipment: '冷藏收货台', hazard: '致病菌、温度失控', controlPoint: '原料中心温度', limit: '≤ 4 ℃', spec: { min: null, max: 4, unit: '℃' }, frequency: '每批', correctiveAction: '拒收并隔离供应商批次' },
    { id: 'P2', name: '巴氏杀菌', equipment: 'HTST-02', hazard: '致病菌残留', controlPoint: '杀菌温度', limit: '≥ 72 ℃ / 15 s', spec: { min: 72, max: null, unit: '℃' }, frequency: '连续记录', correctiveAction: '自动回流并触发偏差' },
    { id: 'P3', name: '金属探测', equipment: 'MD-06', hazard: '金属异物', controlPoint: 'Fe/SUS灵敏度', limit: 'Fe 1.5 mm / SUS 2.0 mm', spec: { min: null, max: 1.5, unit: 'mm Fe' }, frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品' },
    { id: 'P4', name: '灌装封口', equipment: 'FILL-01', hazard: '密封不良', controlPoint: '封口压力', limit: '0.38-0.45 MPa', spec: { min: 0.38, max: 0.45, unit: 'MPa' }, frequency: '每小时', correctiveAction: '停机调机并复检留样' },
    { id: 'P5', name: '终产品冷却', equipment: '冷却隧道', hazard: '芽孢萌发', controlPoint: '冷却结束温度', limit: '≤ 10 ℃ / 2 h', spec: { min: null, max: 10, unit: '℃' }, frequency: '每批', correctiveAction: '延长冷却并观察质量' }
  ]
  return base.map((step) => ({ ...step, ...overrides[step.id] }))
}

export const matrixVersions: MatrixVersion[] = [
  {
    id: 'MX-2026-01', version: 1, effectiveAt: '2026-09-01T00:00:00', publishedAt: '2026-08-28T10:00:00', publishedBy: '质量负责人 秦岚',
    note: '2026 秋季版控制计划，首次发布。',
    steps: steps({})
  },
  {
    id: 'MX-2026-02', version: 2, effectiveAt: '2026-09-30T00:00:00', publishedAt: '2026-09-29T17:30:00', publishedBy: '质量负责人 秦岚',
    note: '关键控制点改版：杀菌温度下限收紧至 75℃；封口压力窗口调整为 0.40-0.46MPa；冷却结束温度收紧至 8℃。仅对生效日后投产批次有效。',
    steps: steps({
      P2: { limit: '≥ 75 ℃ / 15 s', spec: { min: 75, max: null, unit: '℃' } },
      P4: { limit: '0.40-0.46 MPa', spec: { min: 0.40, max: 0.46, unit: 'MPa' } },
      P5: { limit: '≤ 8 ℃ / 2 h', spec: { min: null, max: 8, unit: '℃' } }
    })
  }
]

/** 兼容旧引用：当前最新矩阵版本的控制点 */
export const processSteps: ProcessStep[] = matrixVersions[matrixVersions.length - 1].steps

export const seedBatches: Batch[] = [
  {
    id: 'B260929-01', product: '低温鲜奶 950mL', line: 'L1', quantity: 3200, producedAt: '2026-09-29T06:20:00', status: '隔离中', isolationScope: '杀菌后至金属探测前全部在制品', version: 4,
    matrixVersionId: 'MX-2026-01', conclusionSeq: 0, recalculatedAt: '',
    monitoring: [
      { id: 'M-9001', clientId: 'seed-9001', stepId: 'P1', value: 3.4, unit: '℃', recordedAt: '2026-09-29T06:25:00', operator: '陈莉', source: '人工录入', backfilled: false },
      { id: 'M-9002', clientId: 'seed-9002', stepId: 'P2', value: 70.8, unit: '℃', recordedAt: '2026-09-29T06:48:00', operator: '系统采集', source: '在线采集', backfilled: false },
      { id: 'M-9003', clientId: 'seed-9003', stepId: 'P3', value: 1.5, unit: 'mm Fe', recordedAt: '2026-09-29T07:20:00', operator: '杨鸣', source: '人工录入', backfilled: false }
    ]
  },
  {
    id: 'B260929-02', product: '原味酸奶 200g', line: 'L2', quantity: 8600, producedAt: '2026-09-29T08:10:00', status: '待复核', isolationScope: 'FILL-01本次清洁后产品', version: 3,
    matrixVersionId: 'MX-2026-01', conclusionSeq: 1, recalculatedAt: '',
    lastConclusion: { terminalId: 'T-L2', terminalName: 'L2灌装终端', action: '提交复核', at: '2026-09-29T11:05:00', note: '杀菌后首班，封口压力偏低项待整改确认' },
    monitoring: [
      { id: 'M-9101', clientId: 'seed-9101', stepId: 'P4', value: 0.36, unit: 'MPa', recordedAt: '2026-09-29T08:40:00', operator: '系统采集', source: '在线采集', backfilled: false },
      { id: 'M-9102', clientId: 'seed-9102', stepId: 'P5', value: 8.2, unit: '℃', recordedAt: '2026-09-29T10:10:00', operator: '郑凯', source: '人工录入', backfilled: false }
    ]
  },
  {
    id: 'B260930-03', product: '低脂牛奶 1L', line: 'L1', quantity: 4800, producedAt: '2026-09-30T05:50:00', status: '生产中', isolationScope: '无', version: 1,
    matrixVersionId: 'MX-2026-02', conclusionSeq: 0, recalculatedAt: '',
    monitoring: [
      { id: 'M-9201', clientId: 'seed-9201', stepId: 'P1', value: 2.9, unit: '℃', recordedAt: '2026-09-30T05:58:00', operator: '陈莉', source: '人工录入', backfilled: false },
      { id: 'M-9202', clientId: 'seed-9202', stepId: 'P2', value: 75.6, unit: '℃', recordedAt: '2026-09-30T06:20:00', operator: '系统采集', source: '在线采集', backfilled: false }
    ]
  },
  {
    id: 'B260928-07', product: '低脂牛奶 1L', line: 'L1', quantity: 5100, producedAt: '2026-09-28T16:20:00', status: '已放行', isolationScope: '无', version: 6,
    matrixVersionId: 'MX-2026-01', conclusionSeq: 2, recalculatedAt: '',
    lastConclusion: { terminalId: 'T-QA', terminalName: 'QA放行终端', action: '签字放行', at: '2026-09-28T19:40:00', note: '各控制点满足 MX-2026-01 关键限值，同意放行' },
    release: {
      signedAt: '2026-09-28T19:40:00', signer: '质量负责人 秦岚', terminalId: 'T-QA', terminalName: 'QA放行终端',
      note: '各控制点满足 MX-2026-01 关键限值，同意放行', matrixVersionId: 'MX-2026-01', matrixLabel: 'V1（2026-09-01 生效）', seq: 2,
      lines: [
        { stepId: 'P1', controlPoint: '原料中心温度', limit: '≤ 4 ℃', value: 3.0, unit: '℃', compliant: true, readingId: 'M-9301', source: '人工录入' },
        { stepId: 'P2', controlPoint: '杀菌温度', limit: '≥ 72 ℃ / 15 s', value: 73.2, unit: '℃', compliant: true, readingId: 'M-9302', source: '在线采集' },
        { stepId: 'P3', controlPoint: 'Fe/SUS灵敏度', limit: 'Fe 1.5 mm / SUS 2.0 mm', value: 1.2, unit: 'mm Fe', compliant: true, readingId: 'M-9303', source: '人工录入' },
        { stepId: 'P4', controlPoint: '封口压力', limit: '0.38-0.45 MPa', value: 0.41, unit: 'MPa', compliant: true, readingId: 'M-9304', source: '在线采集' },
        { stepId: 'P5', controlPoint: '冷却结束温度', limit: '≤ 10 ℃ / 2 h', value: 7.8, unit: '℃', compliant: true, readingId: 'M-9305', source: '人工录入' }
      ]
    },
    monitoring: matrixVersions[0].steps.map((step, index) => ({
      id: `M-930${index + 1}`, clientId: `seed-930${index + 1}`, stepId: step.id, value: [3.0, 73.2, 1.2, 0.41, 7.8][index],
      unit: ['℃', '℃', 'mm Fe', 'MPa', '℃'][index], recordedAt: '2026-09-28T17:00:00', operator: '生产线记录', source: '人工录入' as const, backfilled: false
    }))
  }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'DEV-260929-01', batchId: 'B260929-01', stepId: 'P2', title: '杀菌温度低于关键限值', severity: '重大', status: '调查中', owner: '质量工程组', openedAt: '2026-09-29T06:55:00', dueDate: '2026-09-29', version: 3,
    basisMatrixId: 'MX-2026-01', basisLimit: '≥ 72 ℃ / 15 s', sourceReadingId: 'M-9002', autoOpened: true,
    investigation: { cause: '蒸汽调节阀响应滞后', evidence: '趋势图显示70.8℃持续42秒；阀门检修记录已上传', decision: '返工', reworkInstruction: '隔离产品全部回流至平衡槽，重新杀菌并留样验证' }, reviewNote: '', reviewer: ''
  },
  {
    id: 'DEV-260929-02', batchId: 'B260929-02', stepId: 'P4', title: '封口压力偏低', severity: '一般', status: '待复核', owner: '设备保障组', openedAt: '2026-09-29T08:52:00', dueDate: '2026-09-30', version: 2,
    basisMatrixId: 'MX-2026-01', basisLimit: '0.38-0.45 MPa', sourceReadingId: 'M-9101', autoOpened: true,
    investigation: { cause: '气缸密封圈磨损', evidence: '压力曲线、拆检照片、备件领用单', decision: '返工', reworkInstruction: '更换密封圈，返封隔离产品并恢复压力。' }, reviewNote: '', reviewer: ''
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'AUD-1', entity: 'MX-2026-02', action: '发布控制矩阵', operator: '质量负责人 秦岚', detail: 'V2 自 2026-09-30 00:00 生效：杀菌≥75℃、封口0.40-0.46MPa、冷却≤8℃；此前投产批次仍按 V1 判定', createdAt: '2026-09-29T17:30:00' },
  { id: 'AUD-2', entity: 'B260929-01', action: '自动创建偏差', operator: '监控系统', detail: '杀菌温度70.8℃低于 V1 限值72℃，批次已隔离并冻结放行', createdAt: '2026-09-29T06:55:00' },
  { id: 'AUD-3', entity: 'DEV-260929-01', action: '提交调查', operator: '质量工程组', detail: '记录蒸汽阀响应滞后与趋势证据', createdAt: '2026-09-29T08:15:00' },
  { id: 'AUD-4', entity: 'B260929-02', action: '提交复核', operator: 'L2灌装终端', detail: '封口压力偏差待整改，批次保持隔离', createdAt: '2026-09-29T11:05:00' },
  { id: 'AUD-5', entity: 'B260928-07', action: '签字放行', operator: 'QA放行终端', detail: '依据 MX-2026-01 冻结结论并签字，后续矩阵改版不重算', createdAt: '2026-09-28T19:40:00' }
]
