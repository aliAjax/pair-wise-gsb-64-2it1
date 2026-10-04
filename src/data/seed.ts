import type { AuditEntry, Batch, Deviation, MatrixVersion, ProcessStep } from '../types'

export const processSteps: ProcessStep[] = [
  { id: 'P1', name: '原料验收', equipment: '冷藏收货台', hazard: '致病菌、温度失控', controlPoint: '原料中心温度', limit: '≤ 4 ℃', frequency: '每批', correctiveAction: '拒收并隔离供应商批次' },
  { id: 'P2', name: '巴氏杀菌', equipment: 'HTST-02', hazard: '致病菌残留', controlPoint: '杀菌温度', limit: '≥ 72 ℃ / 15 s', frequency: '连续记录', correctiveAction: '自动回流并触发偏差' },
  { id: 'P3', name: '金属探测', equipment: 'MD-06', hazard: '金属异物', controlPoint: 'Fe/SUS灵敏度', limit: 'Fe 1.5 mm / SUS 2.0 mm', frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品' },
  { id: 'P4', name: '灌装封口', equipment: 'FILL-01', hazard: '密封不良', controlPoint: '封口压力', limit: '0.38-0.45 MPa', frequency: '每小时', correctiveAction: '停机调机并复检留样' },
  { id: 'P5', name: '终产品冷却', equipment: '冷却隧道', hazard: '芽孢萌发', controlPoint: '冷却结束温度', limit: '≤ 10 ℃ / 2 h', frequency: '每批', correctiveAction: '延长冷却并观察质量' }
]

export const initialMatrixVersion: MatrixVersion = {
  id: 'MV-1', version: 1, publishedAt: '2026-09-28T08:00:00', publishedBy: '质量主管', note: '初始发布', steps: structuredClone(processSteps)
}

export const seedMatrixVersions: MatrixVersion[] = [initialMatrixVersion]

const reading = (batchId: string, stepId: string, value: number, unit: string, recordedAt: string, operator: string) =>
  ({ stepId, value, unit, recordedAt, operator, submissionId: `SEED-${batchId}-${stepId}-${recordedAt.slice(11, 16).replace(':', '')}`, submittedAt: recordedAt })

export const seedBatches: Batch[] = [
  {
    id: 'B260929-01', product: '低温鲜奶 950mL', line: 'L1', quantity: 3200, producedAt: '2026-09-29T06:20:00', status: '隔离中', isolationScope: '杀菌后至金属探测前全部在制品', version: 4,
    matrixVersionId: 'MV-1', conclusion: null,
    monitoring: [
      reading('B260929-01', 'P1', 3.4, '℃', '2026-09-29T06:25:00', '陈莉'),
      reading('B260929-01', 'P2', 70.8, '℃', '2026-09-29T06:48:00', '系统采集'),
      reading('B260929-01', 'P3', 1.5, 'mm Fe', '2026-09-29T07:20:00', '杨鸣')
    ]
  },
  {
    id: 'B260929-02', product: '原味酸奶 200g', line: 'L2', quantity: 8600, producedAt: '2026-09-29T08:10:00', status: '待复核', isolationScope: 'FILL-01本次清洁后产品', version: 3,
    matrixVersionId: 'MV-1', conclusion: null,
    monitoring: [
      reading('B260929-02', 'P4', 0.36, 'MPa', '2026-09-29T08:40:00', '系统采集'),
      reading('B260929-02', 'P5', 8.2, '℃', '2026-09-29T10:10:00', '郑凯')
    ]
  },
  {
    id: 'B260929-03', product: '高钙牛奶 1L', line: 'L2', quantity: 5400, producedAt: '2026-09-29T09:05:00', status: '待复核', isolationScope: '冷却隧道第二批次', version: 5,
    matrixVersionId: 'MV-1', conclusion: null,
    monitoring: [
      reading('B260929-03', 'P1', 3.1, '℃', '2026-09-29T09:10:00', '陈莉'),
      reading('B260929-03', 'P2', 73.5, '℃', '2026-09-29T09:32:00', '系统采集'),
      reading('B260929-03', 'P3', 1.4, 'mm Fe', '2026-09-29T10:05:00', '杨鸣'),
      reading('B260929-03', 'P4', 0.41, 'MPa', '2026-09-29T10:20:00', '系统采集'),
      reading('B260929-03', 'P5', 12.5, '℃', '2026-09-29T11:40:00', '郑凯')
    ]
  },
  {
    id: 'B260928-07', product: '低脂牛奶 1L', line: 'L1', quantity: 5100, producedAt: '2026-09-28T16:20:00', status: '已放行', isolationScope: '无', version: 6,
    matrixVersionId: 'MV-1', conclusion: null,
    signedAt: '2026-09-28T19:40:00', signedBy: '质量负责人 秦岚', signedMatrixVersionId: 'MV-1',
    monitoring: processSteps.map((step, index) => reading('B260928-07', step.id, [3.0, 73.2, 1.2, 0.41, 7.8][index], ['℃', '℃', 'mm Fe', 'MPa', '℃'][index], '2026-09-28T17:00:00', '生产线记录'))
  },
  {
    id: 'B261004-01', product: '低温鲜奶 950mL', line: 'L1', quantity: 3000, producedAt: '2026-10-04T06:00:00', status: '待投产', isolationScope: '无', version: 1,
    matrixVersionId: null, conclusion: null, monitoring: []
  }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'DEV-260929-01', batchId: 'B260929-01', stepId: 'P2', title: '杀菌温度低于关键限值', severity: '重大', status: '调查中', owner: '质量工程组', openedAt: '2026-09-29T06:55:00', dueDate: '2026-09-29', version: 3,
    sourceSubmissionId: 'SEED-B260929-01-P2-0648',
    investigation: { cause: '蒸汽调节阀响应滞后', evidence: '趋势图显示70.8℃持续42秒；阀门检修记录已上传', decision: '返工', reworkInstruction: '隔离产品全部回流至平衡槽，重新杀菌并留样验证' }, reviewNote: '', reviewer: ''
  },
  {
    id: 'DEV-260929-02', batchId: 'B260929-02', stepId: 'P4', title: '封口压力偏低', severity: '一般', status: '待复核', owner: '设备保障组', openedAt: '2026-09-29T08:52:00', dueDate: '2026-09-30', version: 2,
    sourceSubmissionId: 'SEED-B260929-02-P4-0840',
    investigation: { cause: '气缸密封圈磨损', evidence: '压力曲线、拆检照片、备件领用单', decision: '返工', reworkInstruction: '更换密封圈，返封隔离产品并恢复压力。' }, reviewNote: '', reviewer: ''
  },
  {
    id: 'DEV-260929-03', batchId: 'B260929-03', stepId: 'P5', title: '冷却结束温度超出关键限值', severity: '一般', status: '已关闭', owner: '生产运行组', openedAt: '2026-09-29T11:50:00', dueDate: '2026-09-30', version: 4,
    sourceSubmissionId: 'SEED-B260929-03-P5-1140', closedAt: '2026-09-29T14:20:00',
    investigation: { cause: '冷却隧道二段风机跳停', evidence: '风机电流曲线、维修工单WO-2210', decision: '返工', reworkInstruction: '修复风机后对该批延长冷却并复测。' },
    reviewNote: '纠偏措施已落实，待复测读数确认。', reviewer: '质量负责人 秦岚'
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'AUD-1', entity: 'B260929-01', action: '自动创建偏差', operator: '监控系统', detail: '杀菌温度70.8℃低于限值72℃，批次已隔离', createdAt: '2026-09-29T06:55:00' },
  { id: 'AUD-2', entity: 'DEV-260929-01', action: '提交调查', operator: '质量工程组', detail: '记录蒸汽阀响应滞后与趋势证据', createdAt: '2026-09-29T08:15:00' },
  { id: 'AUD-3', entity: 'B260929-02', action: '状态流转', operator: '杨鸣', detail: '由生产中转为待复核', createdAt: '2026-09-29T08:52:00' },
  { id: 'AUD-4', entity: 'DEV-260929-03', action: '复核通过', operator: '质量负责人 秦岚', detail: '冷却温度偏差关闭，待同一控制点后续合格读数确认', createdAt: '2026-09-29T14:20:00' }
]
