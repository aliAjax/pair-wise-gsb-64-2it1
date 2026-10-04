import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import { evaluateBasis } from './basis'
import { seedBatches } from '../data/seed'
import type { Batch, Deviation, MatrixVersion } from '../types'

export const haccpApi = createApi({
  reducerPath: 'haccpApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    loadBatchSnapshot: builder.query<Batch[], void>({
      queryFn: async () => ({ data: structuredClone(seedBatches) })
    }),
    /** 放行就绪检查与四个模块共用同一份生效依据评估器 */
    checkReleaseReadiness: builder.query<
      { ready: boolean; reasons: string[]; matrixVersionId: string; matrixLabel: string },
      { batch: Batch; deviations: Deviation[]; matrices: MatrixVersion[] }
    >({
      queryFn: async ({ batch, deviations, matrices }) => {
        const evaluation = evaluateBasis(batch, deviations, matrices)
        return {
          data: {
            ready: evaluation.ready,
            reasons: evaluation.reasons.map((item) => item.text),
            matrixVersionId: evaluation.matrix.id,
            matrixLabel: `V${evaluation.matrix.version}（${evaluation.matrix.effectiveAt.slice(0, 10)} 生效）`
          }
        }
      }
    })
  })
})

export const { useLoadBatchSnapshotQuery, useCheckReleaseReadinessQuery } = haccpApi
