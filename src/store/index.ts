import { configureStore } from '@reduxjs/toolkit'
import haccpReducer, { STORAGE_KEY, addMonitoringReading, adoptExternalState, migrateState } from './haccpSlice'
import { haccpApi } from '../services/api'
import { clearPersistError, markPersistError, prunePersistedDrafts, readDrafts } from '../services/drafts'

export const store = configureStore({
  reducer: {
    haccp: haccpReducer,
    [haccpApi.reducerPath]: haccpApi.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(haccpApi.middleware)
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

let lastPersisted: string | null = null
const persistListeners = new Set<(failed: boolean) => void>()

/** 订阅本地写入结果：失败时界面提示并保留草稿，恢复后自动清除 */
export function onPersistChange(listener: (failed: boolean) => void): () => void {
  persistListeners.add(listener)
  return () => persistListeners.delete(listener)
}

function notifyPersist(failed: boolean) {
  persistListeners.forEach((listener) => listener(failed))
}

store.subscribe(() => {
  try {
    const state = store.getState().haccp
    const serialized = JSON.stringify(state)
    localStorage.setItem(STORAGE_KEY, serialized)
    lastPersisted = serialized
    prunePersistedDrafts(state.batches)
    clearPersistError()
    notifyPersist(false)
  } catch {
    // 本地写入失败：内存态继续可用，未完成的监测点草稿保留，刷新后恢复
    markPersistError()
    notifyPersist(true)
  }
})

// 另一终端（标签页）提交后，通过 storage 事件整树采纳其状态，实现先到者生效
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || event.newValue == null || event.newValue === lastPersisted) return
  try {
    store.dispatch(adoptExternalState(migrateState(JSON.parse(event.newValue))))
  } catch {
    // 忽略无法解析的外部状态
  }
})

// 启动时恢复：上次写入失败丢失的已提交读数按幂等键重放，不会重复开偏差
readDrafts()
  .filter((draft) => draft.status === '已提交')
  .forEach((draft) => {
    const batch = store.getState().haccp.batches.find((item) => item.id === draft.batchId)
    if (batch && !batch.monitoring.some((reading) => reading.submissionId === draft.submissionId)) {
      const value = Number(draft.value)
      if (Number.isFinite(value)) {
        store.dispatch(addMonitoringReading({ batchId: draft.batchId, stepId: draft.stepId, value, unit: draft.unit, operator: draft.operator, recordedAt: draft.recordedAt, submissionId: draft.submissionId }))
      }
    }
  })
