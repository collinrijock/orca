import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

function initFixtureGitRepo(repoDir) {
  mkdirSync(repoDir, { recursive: true })
  if (!existsSync(join(repoDir, '.git'))) {
    const init = spawnSync('git', ['init', repoDir], { stdio: 'ignore' })
    if (init.status !== 0) {
      throw new Error(`Failed to create git repo fixture at ${repoDir}`)
    }
  }
  return realpathSync(repoDir)
}

function ensureFixtureCommit(repoPath) {
  const hasHead = spawnSync('git', ['-C', repoPath, 'rev-parse', '--verify', 'HEAD'], {
    stdio: 'ignore'
  })
  if (hasHead.status === 0) {
    return
  }
  const commit = spawnSync(
    'git',
    [
      '-C',
      repoPath,
      '-c',
      'user.name=Orca Startup Bench',
      '-c',
      'user.email=startup-bench@invalid',
      'commit',
      '--allow-empty',
      '-m',
      'fixture root'
    ],
    { stdio: 'ignore' }
  )
  if (commit.status !== 0) {
    throw new Error(`Failed to create the startup benchmark fixture commit at ${repoPath}`)
  }
}

function buildWorktreeFixtures(fixtureDir, workspaceCount) {
  const repoPath = initFixtureGitRepo(join(fixtureDir, 'bench-repo'))
  ensureFixtureCommit(repoPath)
  const worktreePaths = [repoPath]
  if (workspaceCount === 1) {
    return worktreePaths
  }

  const worktreeRoot = join(fixtureDir, 'bench-worktrees')
  mkdirSync(worktreeRoot, { recursive: true })
  for (let i = 1; i < workspaceCount; i++) {
    const worktreePath = join(worktreeRoot, `workspace-${String(i).padStart(4, '0')}`)
    const added = spawnSync(
      'git',
      ['-C', repoPath, 'worktree', 'add', '--detach', worktreePath, 'HEAD'],
      { stdio: 'ignore' }
    )
    if (added.status !== 0) {
      throw new Error(`Failed to create startup benchmark worktree ${i} at ${worktreePath}`)
    }
    worktreePaths.push(realpathSync(worktreePath))
  }
  return worktreePaths
}

function fixtureUuid(value) {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0').slice(-12)}`
}

function buildTerminalLayout(tabIndex, paneCount) {
  const ptyIdsByLeafId = {}
  let root = null
  let firstLeafId = null
  for (let paneIndex = 0; paneIndex < paneCount; paneIndex++) {
    const leafId = fixtureUuid(tabIndex * 10_000 + paneIndex + 1)
    firstLeafId ??= leafId
    ptyIdsByLeafId[leafId] = `bench-pty-${String(tabIndex).padStart(5, '0')}-${paneIndex}`
    const leaf = { type: 'leaf', leafId }
    root =
      root === null
        ? leaf
        : {
            type: 'split',
            direction: paneIndex % 2 === 0 ? 'horizontal' : 'vertical',
            first: root,
            second: leaf,
            ratio: 0.5
          }
  }
  return {
    root,
    activeLeafId: firstLeafId,
    expandedLeafId: null,
    ptyIdsByLeafId
  }
}

function buildTabGroupLayout(groupIds) {
  let root = null
  for (let i = 0; i < groupIds.length; i++) {
    const leaf = { type: 'leaf', groupId: groupIds[i] }
    root =
      root === null
        ? leaf
        : {
            type: 'split',
            direction: i % 2 === 0 ? 'horizontal' : 'vertical',
            first: root,
            second: leaf,
            ratio: 0.5
          }
  }
  return root
}

function buildGithubRepoFixtures(fixtureDir, githubRepos) {
  const repos = []
  for (let i = 0; i < githubRepos; i++) {
    const repoPath = initFixtureGitRepo(join(fixtureDir, `bench-gh-repo-${i}`))
    const remote = spawnSync(
      'git',
      [
        '-C',
        repoPath,
        'remote',
        'add',
        'origin',
        `https://github.com/orca-bench/bench-gh-repo-${i}.git`
      ],
      { stdio: 'ignore' }
    )
    if (remote.status !== 0 && remote.status !== 3) {
      throw new Error(`Failed to add GitHub remote to ${repoPath}`)
    }
    repos.push({
      id: `bench-gh-repo-${i}`,
      path: repoPath,
      displayName: `Bench GH Repo ${i}`,
      badgeColor: '#000000',
      addedAt: 1,
      externalWorktreeVisibility: 'show'
    })
  }
  return repos
}

function buildTerminalState({ worktreeIds, workspaceCount, tabCount, paneCount }) {
  const tabsByWorktree = Object.fromEntries(worktreeIds.map((worktreeId) => [worktreeId, []]))
  const unifiedTabsByWorktree = Object.fromEntries(
    worktreeIds.map((worktreeId) => [worktreeId, []])
  )
  const terminalLayoutsByTabId = {}
  const paneCounts = Array.from({ length: tabCount }, () => 1)
  for (let i = 0; i < paneCount - tabCount; i++) {
    paneCounts[i % tabCount] += 1
  }

  for (let i = 0; i < tabCount; i++) {
    const worktreeId = worktreeIds[i % workspaceCount]
    const tabs = tabsByWorktree[worktreeId]
    const unifiedForWorktree = unifiedTabsByWorktree[worktreeId]
    const tabId = `bench-tab-${String(i).padStart(5, '0')}`
    const layout = buildTerminalLayout(i, paneCounts[i])
    tabs.push({
      id: tabId,
      ptyId: layout.ptyIdsByLeafId[layout.activeLeafId],
      worktreeId,
      title: `Terminal ${i + 1}`,
      customTitle: null,
      color: null,
      sortOrder: tabs.length,
      createdAt: 1
    })
    terminalLayoutsByTabId[tabId] = layout
    unifiedForWorktree.push({
      id: tabId,
      entityId: tabId,
      groupId: '',
      worktreeId,
      contentType: 'terminal',
      label: `Terminal ${i + 1}`,
      customLabel: null,
      color: null,
      sortOrder: unifiedForWorktree.length,
      createdAt: 1,
      isPreview: false,
      isPinned: false
    })
  }
  return { tabsByWorktree, unifiedTabsByWorktree, terminalLayoutsByTabId }
}

function addNonTerminalState({
  worktreePaths,
  worktreeIds,
  unifiedTabsByWorktree,
  workspaceCount,
  editorCount,
  browserCount,
  simulatorCount
}) {
  const openFilesByWorktree = {}
  const browserTabsByWorktree = {}
  const browserPagesByWorkspace = {}
  const activeBrowserTabIdByWorktree = {}
  const addUnifiedTab = (worktreeId, tab) => {
    const entries = unifiedTabsByWorktree[worktreeId]
    entries.push({ ...tab, groupId: '', sortOrder: entries.length, createdAt: 1 })
  }

  for (let i = 0; i < editorCount; i++) {
    const workspaceIndex = i % workspaceCount
    const worktreeId = worktreeIds[workspaceIndex]
    const relativePath = `bench-open-file-${String(i).padStart(4, '0')}.md`
    const filePath = join(worktreePaths[workspaceIndex], relativePath)
    ;(openFilesByWorktree[worktreeId] ??= []).push({
      filePath,
      relativePath,
      worktreeId,
      language: 'markdown'
    })
    addUnifiedTab(worktreeId, {
      id: filePath,
      entityId: filePath,
      worktreeId,
      contentType: 'editor',
      label: relativePath,
      customLabel: null,
      color: null
    })
  }

  for (let i = 0; i < browserCount; i++) {
    const workspaceIndex = i % workspaceCount
    const worktreeId = worktreeIds[workspaceIndex]
    const workspaceId = `bench-browser-${String(i).padStart(4, '0')}`
    const pageId = `bench-browser-page-${String(i).padStart(4, '0')}`
    const url = `https://example.invalid/${i}`
    ;(browserTabsByWorktree[worktreeId] ??= []).push({
      id: workspaceId,
      worktreeId,
      label: `Browser ${i + 1}`,
      activePageId: pageId,
      pageIds: [pageId],
      url,
      title: `Browser ${i + 1}`,
      loading: false,
      faviconUrl: null,
      canGoBack: false,
      canGoForward: false,
      loadError: null,
      createdAt: 1
    })
    browserPagesByWorkspace[workspaceId] = [
      {
        id: pageId,
        workspaceId,
        worktreeId,
        url,
        title: `Browser ${i + 1}`,
        loading: false,
        faviconUrl: null,
        canGoBack: false,
        canGoForward: false,
        loadError: null,
        createdAt: 1
      }
    ]
    activeBrowserTabIdByWorktree[worktreeId] ??= workspaceId
    addUnifiedTab(worktreeId, {
      id: workspaceId,
      entityId: workspaceId,
      worktreeId,
      contentType: 'browser',
      label: `Browser ${i + 1}`,
      customLabel: null,
      color: null
    })
  }

  for (let i = 0; i < simulatorCount; i++) {
    const worktreeId = worktreeIds[i % workspaceCount]
    const simulatorId = `bench-simulator-${String(i).padStart(4, '0')}`
    addUnifiedTab(worktreeId, {
      id: simulatorId,
      entityId: simulatorId,
      worktreeId,
      contentType: 'simulator',
      label: `Simulator ${i + 1}`,
      customLabel: null,
      color: null
    })
  }
  return {
    openFilesByWorktree,
    browserTabsByWorktree,
    browserPagesByWorkspace,
    activeBrowserTabIdByWorktree
  }
}

function buildTabGroupState({
  worktreeIds,
  tabsByWorktree,
  unifiedTabsByWorktree,
  workspaceCount,
  requestedTabGroupCount
}) {
  const tabGroups = {}
  const tabGroupLayouts = {}
  const activeGroupIdByWorktree = {}
  const activeTabIdByWorktree = {}
  let remainingExtraGroups = requestedTabGroupCount - workspaceCount
  for (let workspaceIndex = 0; workspaceIndex < workspaceCount; workspaceIndex++) {
    const worktreeId = worktreeIds[workspaceIndex]
    const tabs = unifiedTabsByWorktree[worktreeId]
    const extraGroups = Math.min(remainingExtraGroups, Math.max(0, tabs.length - 1))
    remainingExtraGroups -= extraGroups
    const groupIds = Array.from(
      { length: 1 + extraGroups },
      (_, groupIndex) => `bench-group-${String(workspaceIndex).padStart(4, '0')}-${groupIndex}`
    )
    const groupTabIds = groupIds.map(() => [])
    tabs.forEach((tab, tabIndex) => {
      const groupIndex = tabIndex % groupIds.length
      tab.groupId = groupIds[groupIndex]
      groupTabIds[groupIndex].push(tab.id)
    })
    tabGroups[worktreeId] = groupIds.map((groupId, groupIndex) => ({
      id: groupId,
      worktreeId,
      activeTabId: groupTabIds[groupIndex][0] ?? null,
      tabOrder: groupTabIds[groupIndex],
      recentTabIds: groupTabIds[groupIndex].slice(0, 3)
    }))
    tabGroupLayouts[worktreeId] = buildTabGroupLayout(groupIds)
    activeGroupIdByWorktree[worktreeId] = groupIds[0]
    activeTabIdByWorktree[worktreeId] = tabsByWorktree[worktreeId][0]?.id ?? null
  }
  if (remainingExtraGroups > 0) {
    throw new Error('Requested more tab groups than the fixture tabs can populate')
  }
  return { tabGroups, tabGroupLayouts, activeGroupIdByWorktree, activeTabIdByWorktree }
}

function writePersistedStateFixture(fixtureDir, options) {
  const dataPath = join(fixtureDir, 'orca-data.json')
  if (options.stateProfile === 'none' && options.githubRepos === 0) {
    try {
      unlinkSync(dataPath)
    } catch {
      // no persisted state fixture
    }
    return 0
  }

  const githubRepoEntries = buildGithubRepoFixtures(fixtureDir, options.githubRepos)
  if (options.stateProfile === 'none') {
    const json = JSON.stringify(
      {
        schemaVersion: 1,
        repos: githubRepoEntries,
        settings: {
          telemetry: {
            installId: 'startup-bench',
            optedIn: false,
            existedBeforeTelemetryRelease: true
          }
        }
      },
      null,
      2
    )
    writeFileSync(dataPath, json, 'utf-8')
    return Buffer.byteLength(json)
  }

  const repoId = 'bench-repo'
  const workspaceCount = Math.max(1, options.workspaces)
  const tabCount = Math.max(1, options.sessionTabs)
  const unifiedTabCount = Math.max(tabCount, options.unifiedTabs)
  const paneCount = Math.max(tabCount, options.terminalPanes)
  const requestedTabGroupCount = Math.max(workspaceCount, options.tabGroups)
  const worktreePaths = buildWorktreeFixtures(fixtureDir, workspaceCount)
  const worktreeIds = worktreePaths.map((worktreePath) => `${repoId}::${worktreePath}`)
  const terminal = buildTerminalState({ worktreeIds, workspaceCount, tabCount, paneCount })
  const remainingUnifiedTabs = unifiedTabCount - tabCount
  const editorCount = Math.min(options.openFiles, remainingUnifiedTabs)
  const browserCount = Math.min(options.browserTabs, remainingUnifiedTabs - editorCount)
  const nonTerminal = addNonTerminalState({
    worktreePaths,
    worktreeIds,
    unifiedTabsByWorktree: terminal.unifiedTabsByWorktree,
    workspaceCount,
    editorCount,
    browserCount,
    simulatorCount: remainingUnifiedTabs - editorCount - browserCount
  })
  const groups = buildTabGroupState({
    worktreeIds,
    tabsByWorktree: terminal.tabsByWorktree,
    unifiedTabsByWorktree: terminal.unifiedTabsByWorktree,
    workspaceCount,
    requestedTabGroupCount
  })
  const activeWorktreeId = worktreeIds[0]
  const activeTabTypeByWorktree = Object.fromEntries(
    worktreeIds.map((worktreeId) => [worktreeId, 'terminal'])
  )
  const state = {
    schemaVersion: 1,
    repos: [
      {
        id: repoId,
        path: worktreePaths[0],
        displayName: 'Bench Repo',
        badgeColor: '#000000',
        addedAt: 1,
        externalWorktreeVisibility: 'show'
      },
      ...githubRepoEntries
    ],
    settings: {
      telemetry: {
        installId: 'startup-bench',
        optedIn: false,
        existedBeforeTelemetryRelease: true
      }
    },
    ui: { lastActiveRepoId: repoId, lastActiveWorktreeId: activeWorktreeId },
    workspaceSession: {
      activeRepoId: repoId,
      activeWorktreeId,
      activeTabId: terminal.tabsByWorktree[activeWorktreeId][0]?.id ?? null,
      tabsByWorktree: terminal.tabsByWorktree,
      terminalLayoutsByTabId: terminal.terminalLayoutsByTabId,
      openFilesByWorktree: nonTerminal.openFilesByWorktree,
      browserTabsByWorktree: nonTerminal.browserTabsByWorktree,
      browserPagesByWorkspace: nonTerminal.browserPagesByWorkspace,
      activeBrowserTabIdByWorktree: nonTerminal.activeBrowserTabIdByWorktree,
      activeTabTypeByWorktree,
      activeTabIdByWorktree: groups.activeTabIdByWorktree,
      unifiedTabs: terminal.unifiedTabsByWorktree,
      tabGroups: groups.tabGroups,
      tabGroupLayouts: groups.tabGroupLayouts,
      activeGroupIdByWorktree: groups.activeGroupIdByWorktree,
      activeWorktreeIdsOnShutdown: worktreeIds.slice(
        0,
        Math.min(options.activeWorkspaces, workspaceCount)
      ),
      lastVisitedAtByWorktreeId: Object.fromEntries(
        worktreeIds.map((worktreeId, index) => [worktreeId, index + 1])
      ),
      defaultTerminalTabsAppliedByWorktreeId: Object.fromEntries(
        worktreeIds.map((worktreeId) => [worktreeId, true])
      )
    }
  }
  const json = JSON.stringify(state, null, 2)
  writeFileSync(dataPath, json, 'utf-8')
  return Buffer.byteLength(json)
}

function manifestMatches(manifest, options) {
  return (
    manifest.files === options.fileCount &&
    manifest.stateProfile === options.stateProfile &&
    manifest.sessionTabs === options.sessionTabs &&
    (manifest.workspaces ?? 1) === options.workspaces &&
    (manifest.unifiedTabs ?? manifest.sessionTabs) === options.unifiedTabs &&
    (manifest.tabGroups ?? manifest.workspaces ?? 1) === options.tabGroups &&
    (manifest.terminalPanes ?? manifest.sessionTabs) === options.terminalPanes &&
    (manifest.activeWorkspaces ?? 1) === options.activeWorkspaces &&
    (manifest.openFiles ?? 0) === options.openFiles &&
    (manifest.browserTabs ?? 0) === options.browserTabs &&
    (manifest.githubRepos ?? 0) === options.githubRepos
  )
}

export function ensureStartupBenchmarkFixture(fixtureDir, options) {
  const manifestPath = join(fixtureDir, 'bench-fixture-manifest.json')
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (manifestMatches(manifest, options)) {
        console.log(
          `[fixture] reusing ${fixtureDir} (${options.fileCount} files, state=${options.stateProfile})`
        )
        return
      }
    } catch {
      // fall through and rebuild
    }
  }

  console.log(`[fixture] creating ${fixtureDir} with ~${options.fileCount} synthetic files…`)
  // Why: linked-worktree registrations survive deleting only their directories.
  // Rebuild both controlled trees together when the requested profile changes.
  rmSync(join(fixtureDir, 'bench-repo'), { recursive: true, force: true })
  rmSync(join(fixtureDir, 'bench-worktrees'), { recursive: true, force: true })
  const buckets = [
    ['Cache', 'Cache_Data'],
    ['Code Cache', 'js'],
    ['Code Cache', 'wasm'],
    ['GPUCache'],
    ['DawnGraphiteCache'],
    ['blob_storage', 'blobs'],
    ['Service Worker', 'CacheStorage'],
    ['terminal-scrollback-snapshots']
  ]
  const payload = 'x'.repeat(1024)
  let written = 0
  const started = Date.now()
  for (let b = 0; written < options.fileCount; b = (b + 1) % buckets.length) {
    const dir = join(fixtureDir, ...buckets[b], `g${Math.floor(written / 512)}`)
    mkdirSync(dir, { recursive: true })
    const batch = Math.min(512, options.fileCount - written)
    for (let i = 0; i < batch; i++) {
      writeFileSync(join(dir, `f_${String(written + i).padStart(6, '0')}`), payload)
    }
    written += batch
  }
  const persistedStateBytes = writePersistedStateFixture(fixtureDir, options)
  writeFileSync(
    manifestPath,
    JSON.stringify({
      files: options.fileCount,
      stateProfile: options.stateProfile,
      sessionTabs: options.sessionTabs,
      workspaces: options.workspaces,
      unifiedTabs: options.unifiedTabs,
      tabGroups: options.tabGroups,
      terminalPanes: options.terminalPanes,
      activeWorkspaces: options.activeWorkspaces,
      openFiles: options.openFiles,
      browserTabs: options.browserTabs,
      githubRepos: options.githubRepos,
      persistedStateBytes,
      createdAt: Date.now()
    })
  )
  console.log(`[fixture] done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}
