import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import type { AppDispatch, RootState } from './index'
import { commitReading, commitConclusion } from './haccpSlice'
import { evaluateBasis } from '../services/basis'
import type { ConclusionDraft, ConflictNotice, OutboxEntry, ReadingInput, TerminalState } from '../types'

const TERMINAL_KEY = 'gsb64:terminal-session'

function loadTerminal(): TerminalState {
  try {
    const raw = sessionStorage.getItem(TERMINAL_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // 忽略损坏的会话数据
  }
  return {
    terminalId: `T-${nanoid(4)}`,
    terminalName: `终端 ${Math.floor(Math.random() * 90 + 10)}`,
    simulateFailure: false,
    outbox: [],
    drafts: {},
    conflict: null
  }
}

const initialState: TerminalState = loadTerminal()

const terminalSlice = createSlice({
  name: 'terminal',
  initialState,
  reducers: {
    setTerminalName(state, action: PayloadAction<string>) { state.terminalName = action.payload || state.terminalName },
    setSimulateFailure(state, action: PayloadAction<boolean>) { state.simulateFailure = action.payload },
    enqueueOutbox(state, action: PayloadAction<ReadingInput>) {
      // 同一未完成监测点重复补传只保留一条
      const entry: OutboxEntry = { ...action.payload, failedAt: new Date().toISOString(), attempts: 0 }
      state.outbox = state.outbox.filter((item) => item.clientId !== entry.clientId)
      state.outbox.unshift(entry)
    },
    markAttempt(state, action: PayloadAction<{ clientId: string }>) {
      const entry = state.outbox.find((item) => item.clientId === action.payload.clientId)
      if (entry) { entry.attempts += 1; entry.failedAt = new Date().toISOString() }
    },
    removeOutbox(state, action: PayloadAction<{ clientId: string }>) {
      state.outbox = state.outbox.filter((item) => item.clientId !== action.payload.clientId)
    },
    saveDraft(state, action: PayloadAction<ConclusionDraft>) {
      state.drafts[action.payload.batchId] = action.payload
    },
    clearDraft(state, action: PayloadAction<{ batchId: string }>) {
      delete state.drafts[action.payload.batchId]
    },
    setConflict(state, action: PayloadAction<ConflictNotice | null>) { state.conflict = action.payload },
    resetTerminal(state) {
      state.outbox = []
      state.drafts = {}
      state.conflict = null
      state.simulateFailure = false
    }
  }
})

export const { setTerminalName, setSimulateFailure, enqueueOutbox, markAttempt, removeOutbox, saveDraft, clearDraft, setConflict, resetTerminal } = terminalSlice.actions

/**
 * 提交监测读数：
 * - simulateFailure（本地写入失败）时只进入 outbox，恢复后幂等补传；
 * - 成功路径由 commitReading 保证 clientId 幂等，重复补传不重复开偏差。
 */
export function submitReading(input: Omit<ReadingInput, 'clientId'> & { clientId?: string }) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const terminal = getState().terminal
    const reading: ReadingInput = { ...input, clientId: input.clientId ?? `R-${nanoid(10)}` }
    if (terminal.simulateFailure) {
      dispatch(enqueueOutbox(reading))
      return { accepted: false as const, offline: true as const, clientId: reading.clientId }
    }
    dispatch(commitReading(reading))
    const result = getState().haccp.lastIngest
    return {
      accepted: true as const, offline: false as const, clientId: reading.clientId,
      duplicate: result?.clientId === reading.clientId ? result.duplicate : false,
      openedDeviationId: result?.clientId === reading.clientId ? result.openedDeviationId : undefined
    }
  }
}

/** 本地写入恢复后重放未完成监测点；commitReading 幂等，已落库的读数不会重复开偏差 */
export function flushOutbox() {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const pending = [...getState().terminal.outbox]
    const report: Array<{ clientId: string; duplicate: boolean; openedDeviationId?: string }> = []
    for (const entry of pending) {
      dispatch(commitReading(entry))
      const result = getState().haccp.lastIngest
      report.push({
        clientId: entry.clientId,
        duplicate: result?.clientId === entry.clientId ? result.duplicate : true,
        openedDeviationId: result?.clientId === entry.clientId ? result.openedDeviationId : undefined
      })
      dispatch(removeOutbox({ clientId: entry.clientId }))
    }
    return report
  }
}

export interface SubmitConclusionRequest {
  batchId: string
  action: '提交复核' | '签字放行'
  note: string
  signer: string
  /** 本机草稿基于的结论版本；不传则以服务端当前版本为基准 */
  baseSeq?: number
}

export type SubmitConclusionResult =
  | { outcome: 'frozen' }
  | { outcome: 'blocked'; reasons: string[] }
  | {
      outcome: 'conflict'; draft: ConclusionDraft; currentSeq: number
      otherTerminalName: string; otherAction: string; otherAt: string
    }
  | { outcome: 'committed'; seq: number }

/**
 * 两台终端同时提交同一批次结论：先到者生效（conclusionSeq 先被抬升），
 * 后到者基于旧版本提交时检测到冲突——填值保留在草稿中，并拿到冲突信息。
 */
export function submitConclusion(request: SubmitConclusionRequest) {
  return (dispatch: AppDispatch, getState: () => RootState): SubmitConclusionResult => {
    const { haccp, terminal } = getState()
    const batch = haccp.batches.find((item) => item.id === request.batchId)
    if (!batch) return { outcome: 'blocked', reasons: ['批次不存在'] }
    if (batch.release) return { outcome: 'frozen' }

    const evaluation = evaluateBasis(batch, haccp.deviations, haccp.matrices)
    if (!evaluation.ready) return { outcome: 'blocked', reasons: evaluation.reasons.map((item) => item.text) }

    const baseSeq = request.baseSeq ?? batch.conclusionSeq
    const draft: ConclusionDraft = {
      batchId: batch.id, note: request.note, signer: request.signer,
      baseSeq, updatedAt: new Date().toISOString()
    }
    dispatch(saveDraft(draft))

    if (batch.conclusionSeq !== baseSeq && batch.lastConclusion) {
      const notice: ConflictNotice = {
        batchId: batch.id, baseSeq, currentSeq: batch.conclusionSeq,
        otherTerminalName: batch.lastConclusion.terminalName,
        action: batch.lastConclusion.action, at: batch.lastConclusion.at
      }
      dispatch(setConflict(notice))
      return {
        outcome: 'conflict', draft, currentSeq: batch.conclusionSeq,
        otherTerminalName: batch.lastConclusion.terminalName,
        otherAction: batch.lastConclusion.action, otherAt: batch.lastConclusion.at
      }
    }

    dispatch(commitConclusion({
      batchId: batch.id, action: request.action, note: request.note, signer: request.signer,
      terminalId: terminal.terminalId, terminalName: terminal.terminalName
    }))
    dispatch(clearDraft({ batchId: batch.id }))
    dispatch(setConflict(null))
    const committed = getState().haccp.batches.find((item) => item.id === batch.id)
    return { outcome: 'committed', seq: committed?.conclusionSeq ?? baseSeq + 1 }
  }
}

export default terminalSlice.reducer
