import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalBoolean } from '../schemas'
import { AI_VAULT_SCOPE_PATHS_MAX_COUNT } from '../../../../shared/ai-vault-types'

// Why: bound limit + scopePaths so a client cannot force an unbounded scan.
// Each scopePath is a host-local match prefix (validated/capped, never used for
// traversal); the count/length caps mirror the worktree-schemas bounding style.
const AI_VAULT_SCOPE_PATH_MAX_LENGTH = 4096
const AI_VAULT_LIMIT_MAX = 2000

export const AiVaultListSessionsParams = z.object({
  limit: z
    .unknown()
    .transform((value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
    )
    .pipe(z.union([z.number().int().max(AI_VAULT_LIMIT_MAX), z.undefined()]))
    .optional(),
  force: OptionalBoolean,
  scopePaths: z
    .array(z.string().min(1).max(AI_VAULT_SCOPE_PATH_MAX_LENGTH))
    .max(AI_VAULT_SCOPE_PATHS_MAX_COUNT)
    .optional()
})

export const AI_VAULT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'aiVault.listSessions',
    params: AiVaultListSessionsParams,
    handler: (params, { runtime }) =>
      runtime.listAiVaultSessions({
        limit: params.limit,
        force: params.force,
        scopePaths: params.scopePaths
      })
  })
]
