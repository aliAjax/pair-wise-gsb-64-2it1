import type { Batch } from '../types'

/** 未完成监测点草稿：独立于主状态存储，主状态写入失败时仍能恢复 */
export interface MonitoringDraft {
  submissionId: string
  batchId: string
  stepId: string
  value: string
  unit: string
  operator: string
  recordedAt: string
  status: '编辑中' | '已提交'
  savedAt: string
}

const DRAFTS_KEY = 'gsb64:haccp-drafts'
const PERSIST_ERROR_KEY = 'gsb64:haccp-persist-error'

export function readDrafts(): MonitoringDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    return raw ? (JSON.parse(raw) as MonitoringDraft[]) : []
  } catch {
    return []
  }
}

function writeDrafts(drafts: MonitoringDraft[]): boolean {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
    return true
  } catch {
    return false
  }
}

export function upsertDraft(draft: MonitoringDraft): boolean {
  const drafts = readDrafts().filter((item) => item.submissionId !== draft.submissionId)
  drafts.push(draft)
  return writeDrafts(drafts)
}

export function removeDraft(submissionId: string): void {
  writeDrafts(readDrafts().filter((item) => item.submissionId !== submissionId))
}

/** 主状态持久化成功后，清理已经入库的已提交草稿 */
export function prunePersistedDrafts(batches: Batch[]): void {
  const persisted = new Set(batches.flatMap((batch) => batch.monitoring.map((reading) => reading.submissionId)))
  const remaining = readDrafts().filter((draft) => !(draft.status === '已提交' && persisted.has(draft.submissionId)))
  writeDrafts(remaining)
}

export function markPersistError(): void {
  try {
    localStorage.setItem(PERSIST_ERROR_KEY, new Date().toISOString())
  } catch {
    // 连标记都写不下时，内存态仍可用，刷新后按草稿恢复
  }
}

export function clearPersistError(): void {
  try {
    localStorage.removeItem(PERSIST_ERROR_KEY)
  } catch {
    // 忽略
  }
}

export function readPersistError(): string | null {
  try {
    return localStorage.getItem(PERSIST_ERROR_KEY)
  } catch {
    return null
  }
}
