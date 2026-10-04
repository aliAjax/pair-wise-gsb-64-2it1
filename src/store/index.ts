import { configureStore } from '@reduxjs/toolkit'
import haccpReducer, { hydrateShared, STORAGE_KEY } from './haccpSlice'
import terminalReducer from './terminalSlice'
import { haccpApi } from '../services/api'

export const store = configureStore({
  reducer: {
    haccp: haccpReducer,
    terminal: terminalReducer,
    [haccpApi.reducerPath]: haccpApi.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(haccpApi.middleware)
})

// 共享业务数据 → localStorage（多终端/多标签页共用）；本机终端态 → sessionStorage（仅本机）
store.subscribe(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().haccp))
  } catch {
    // 共享存储不可用时，业务流仍可继续（终端可开启“本地写入失败”挂起监测点）
  }
  try {
    sessionStorage.setItem('gsb64:terminal-session', JSON.stringify(store.getState().terminal))
  } catch {
    // 会话存储不可用时忽略
  }
})

// 另一终端先提交结论后，本机通过 storage 事件看到其已生效的状态（先到者生效）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const snapshot = JSON.parse(event.newValue)
      const current = store.getState().haccp
      if (snapshot && snapshot.audit && JSON.stringify(snapshot.audit[0]) !== JSON.stringify(current.audit[0])) {
        store.dispatch(hydrateShared(snapshot))
      }
    } catch {
      // 忽略无法解析的广播
    }
  })
}

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
