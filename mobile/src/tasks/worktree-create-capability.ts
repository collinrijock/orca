// Why: older hosts strip worktree.create's clientMutationId, so mobile must not
// replay an ambiguous create unless the host advertises idempotency support.
// Mirrors WORKTREE_CREATE_IDEMPOTENCY_RUNTIME_CAPABILITY in the shared protocol.
export const MOBILE_WORKTREE_CREATE_IDEMPOTENCY_CAPABILITY = 'worktree.create-idempotency.v1'
