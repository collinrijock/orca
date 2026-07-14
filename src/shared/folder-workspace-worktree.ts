import type { FolderWorkspace, Worktree } from './types'
import { folderWorkspaceKey } from './workspace-scope'

// A folder (non-git) workspace's synthetic repo id is `folder-workspace:<pgid>`.
// Git repo ids are bare UUIDs, so this prefix uniquely identifies folder repos.
export const FOLDER_WORKSPACE_REPO_ID_PREFIX = 'folder-workspace:'

export function isFolderWorkspaceRepoId(repoId: string): boolean {
  return repoId.startsWith(FOLDER_WORKSPACE_REPO_ID_PREFIX)
}

export function folderWorkspaceToWorktree(folderWorkspace: FolderWorkspace): Worktree {
  const linkedTask = folderWorkspace.linkedTask
  return {
    id: folderWorkspaceKey(folderWorkspace.id),
    repoId: `${FOLDER_WORKSPACE_REPO_ID_PREFIX}${folderWorkspace.projectGroupId}`,
    displayName: folderWorkspace.name,
    comment: folderWorkspace.comment,
    linkedIssue:
      linkedTask?.provider === 'github' && linkedTask.type === 'issue' ? linkedTask.number : null,
    linkedPR: null,
    linkedLinearIssue:
      linkedTask?.provider === 'linear' ? (linkedTask.linearIdentifier ?? null) : null,
    linkedGitLabMR: null,
    linkedGitLabIssue:
      linkedTask?.provider === 'gitlab' && linkedTask.type === 'issue' ? linkedTask.number : null,
    linkedBitbucketPR: null,
    linkedAzureDevOpsPR: null,
    linkedGiteaPR: null,
    isArchived: folderWorkspace.isArchived,
    isUnread: folderWorkspace.isUnread,
    isPinned: folderWorkspace.isPinned,
    sortOrder: folderWorkspace.sortOrder,
    manualOrder: folderWorkspace.manualOrder,
    lastActivityAt: folderWorkspace.lastActivityAt,
    createdAt: folderWorkspace.createdAt,
    createdWithAgent: folderWorkspace.createdWithAgent,
    pendingFirstAgentMessageRename: folderWorkspace.pendingFirstAgentMessageRename,
    firstAgentMessageRenameError: folderWorkspace.firstAgentMessageRenameError,
    workspaceStatus: folderWorkspace.workspaceStatus,
    path: folderWorkspace.folderPath,
    head: '',
    branch: '',
    isBare: false,
    isSparse: false,
    isMainWorktree: false
  }
}
