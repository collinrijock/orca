import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()
const getTerminalHandleMock = vi.hoisted(() => vi.fn())
const originalTerminalHandle = process.env.ORCA_TERMINAL_HANDLE
function lifecycleGroupRecipientError(type: 'worker_done' | 'heartbeat'): string {
  return `${type} messages must be sent to a concrete coordinator terminal handle, not a group address.`
}

// Why: isolate the handler's flag-to-param mapping; printResult only writes output.
vi.mock('../format', () => ({ printResult: vi.fn() }))
vi.mock('../selectors', () => ({ getTerminalHandle: getTerminalHandleMock }))

import { ORCHESTRATION_HANDLERS } from './orchestration'
import { RuntimeClientError } from '../runtime-client'

afterEach(() => {
  getTerminalHandleMock.mockReset()
  if (originalTerminalHandle === undefined) {
    delete process.env.ORCA_TERMINAL_HANDLE
  } else {
    process.env.ORCA_TERMINAL_HANDLE = originalTerminalHandle
  }
})

describe('orchestration reset CLI handler', () => {
  beforeEach(() => {
    callMock.mockReset().mockResolvedValue({ result: { reset: 'all' } })
  })

  const invoke = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration reset']({
      flags,
      client: { call: callMock },
      json: true
    } as never)

  it('sends all: true for a bare `reset` (no scope flag)', async () => {
    await invoke(new Map())
    expect(callMock).toHaveBeenCalledWith('orchestration.reset', {
      all: true,
      tasks: undefined,
      messages: undefined
    })
  })

  it('sends only the tasks scope for --tasks', async () => {
    await invoke(new Map([['tasks', true]]))
    expect(callMock).toHaveBeenCalledWith('orchestration.reset', {
      all: undefined,
      tasks: true,
      messages: undefined
    })
  })

  it('sends only the all scope for --all (no implicit extra scopes)', async () => {
    await invoke(new Map([['all', true]]))
    expect(callMock).toHaveBeenCalledWith('orchestration.reset', {
      all: true,
      tasks: undefined,
      messages: undefined
    })
  })
})

describe('orchestration send structured payload flags', () => {
  beforeEach(() => {
    callMock.mockReset().mockResolvedValue({ result: { message: { id: 'msg_1' } } })
    getTerminalHandleMock.mockReset()
    delete process.env.ORCA_TERMINAL_HANDLE
  })

  const invokeSend = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration send']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  it('serializes common worker payload fields as JSON', async () => {
    await invokeSend(
      new Map<string, string | boolean>([
        ['from', 'term_worker'],
        ['to', 'term_coord'],
        ['subject', 'done'],
        ['type', 'worker_done'],
        ['task-id', 'task_1'],
        ['dispatch-id', 'ctx_1'],
        ['files-modified', 'src/a.ts, src/b.ts'],
        ['report-path', 'reports/done.md']
      ])
    )

    expect(callMock).toHaveBeenCalledWith('orchestration.send', {
      from: 'term_worker',
      to: 'term_coord',
      subject: 'done',
      body: undefined,
      type: 'worker_done',
      priority: undefined,
      threadId: undefined,
      payload: JSON.stringify({
        taskId: 'task_1',
        dispatchId: 'ctx_1',
        filesModified: ['src/a.ts', 'src/b.ts'],
        reportPath: 'reports/done.md'
      }),
      devMode: false
    })
  })

  it('rejects mixing raw payload with structured payload flags', async () => {
    await expect(
      invokeSend(
        new Map<string, string | boolean>([
          ['from', 'term_worker'],
          ['to', 'term_coord'],
          ['subject', 'done'],
          ['payload', '{"taskId":"task_1"}'],
          ['task-id', 'task_1']
        ])
      )
    ).rejects.toThrow(/structured payload/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('rejects worker_done group sends before resolving a sender handle', async () => {
    getTerminalHandleMock.mockRejectedValue(new Error('sender resolution should not run'))

    await expect(
      invokeSend(
        new Map<string, string | boolean>([
          ['to', '@all'],
          ['subject', 'done'],
          ['type', 'worker_done']
        ])
      )
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: lifecycleGroupRecipientError('worker_done')
    })

    expect(getTerminalHandleMock).not.toHaveBeenCalled()
    expect(callMock).not.toHaveBeenCalled()
  })

  it('rejects heartbeat group sends before resolving a sender handle', async () => {
    getTerminalHandleMock.mockRejectedValue(new Error('sender resolution should not run'))

    await expect(
      invokeSend(
        new Map<string, string | boolean>([
          ['to', '@idle'],
          ['subject', 'alive'],
          ['type', 'heartbeat']
        ])
      )
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: lifecycleGroupRecipientError('heartbeat')
    })

    expect(getTerminalHandleMock).not.toHaveBeenCalled()
    expect(callMock).not.toHaveBeenCalled()
  })

  it('continues to allow worker_done to a concrete terminal handle', async () => {
    await invokeSend(
      new Map<string, string | boolean>([
        ['from', 'term_worker'],
        ['to', 'term_coord'],
        ['subject', 'done'],
        ['type', 'worker_done']
      ])
    )

    expect(callMock).toHaveBeenCalledWith('orchestration.send', {
      from: 'term_worker',
      to: 'term_coord',
      subject: 'done',
      body: undefined,
      type: 'worker_done',
      priority: undefined,
      threadId: undefined,
      payload: undefined,
      devMode: false
    })
  })

  it('continues to use ORCA_TERMINAL_HANDLE as worker lifecycle sender authority', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_worker_env'

    await invokeSend(
      new Map<string, string | boolean>([
        ['to', 'term_coord'],
        ['subject', 'done'],
        ['type', 'worker_done']
      ])
    )

    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('orchestration.send', {
      from: 'term_worker_env',
      to: 'term_coord',
      subject: 'done',
      body: undefined,
      type: 'worker_done',
      priority: undefined,
      threadId: undefined,
      payload: undefined,
      devMode: false
    })
  })

  it('reports sender resolution failure instead of raw no_active_terminal', async () => {
    getTerminalHandleMock.mockRejectedValue(
      new RuntimeClientError('no_active_terminal', 'no_active_terminal')
    )

    await expect(
      invokeSend(
        new Map<string, string | boolean>([
          ['to', 'term_coord'],
          ['subject', 'done'],
          ['type', 'worker_done']
        ])
      )
    ).rejects.toMatchObject({
      code: 'no_active_sender_terminal',
      message: expect.stringContaining('Pass --from')
    })
    expect(callMock).not.toHaveBeenCalled()
  })
})

describe('orchestration dispatch coordinator handle', () => {
  beforeEach(() => {
    callMock.mockReset()
    getTerminalHandleMock.mockReset()
    delete process.env.ORCA_TERMINAL_HANDLE
  })

  const invokeDispatch = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration dispatch']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  const invokeDispatchShow = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration dispatch-show']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  it('falls back to active sender resolution when env handle is stale', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_stale_coord'
    callMock
      .mockRejectedValueOnce(
        new RuntimeClientError('terminal_handle_stale', 'terminal_handle_stale')
      )
      .mockResolvedValueOnce({
        result: { dispatch: { id: 'ctx_1', task_id: 'task_1', status: 'dispatched' } }
      })
    getTerminalHandleMock.mockResolvedValue('term_live_coord')

    await invokeDispatch(
      new Map<string, string | boolean>([
        ['task', 'task_1'],
        ['to', 'term_worker'],
        ['inject', true]
      ])
    )

    expect(callMock).toHaveBeenNthCalledWith(1, 'terminal.show', {
      terminal: 'term_stale_coord'
    })
    expect(getTerminalHandleMock).toHaveBeenCalled()
    expect(callMock).toHaveBeenNthCalledWith(2, 'orchestration.dispatch', {
      task: 'task_1',
      to: 'term_worker',
      from: 'term_live_coord',
      inject: true,
      dryRun: undefined,
      returnPreamble: undefined,
      devMode: false
    })
  })

  it('uses a live coordinator handle for dispatch-show preamble previews', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_stale_coord'
    callMock
      .mockRejectedValueOnce(
        new RuntimeClientError('terminal_handle_stale', 'terminal_handle_stale')
      )
      .mockResolvedValueOnce({
        result: { dispatch: null, preamble: 'preamble' }
      })
    getTerminalHandleMock.mockResolvedValue('term_live_coord')

    await invokeDispatchShow(
      new Map<string, string | boolean>([
        ['task', 'task_1'],
        ['preamble', true]
      ])
    )

    expect(callMock).toHaveBeenNthCalledWith(1, 'terminal.show', {
      terminal: 'term_stale_coord'
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'orchestration.dispatchShow', {
      task: 'task_1',
      preamble: true,
      from: 'term_live_coord',
      devMode: false
    })
  })
})

describe('orchestration task-create caller handle', () => {
  beforeEach(() => {
    callMock.mockReset()
    getTerminalHandleMock.mockReset()
    delete process.env.ORCA_TERMINAL_HANDLE
  })

  const invokeTaskCreate = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration task-create']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  it('records a live env terminal handle as task creator', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_creator'
    callMock
      .mockResolvedValueOnce({ result: { terminal: { handle: 'term_creator' } } })
      .mockResolvedValueOnce({ result: { task: { id: 'task_1', status: 'ready' } } })

    await invokeTaskCreate(new Map<string, string | boolean>([['spec', 'do work']]))

    expect(callMock).toHaveBeenNthCalledWith(1, 'terminal.show', { terminal: 'term_creator' })
    expect(callMock).toHaveBeenNthCalledWith(2, 'orchestration.taskCreate', {
      spec: 'do work',
      taskTitle: undefined,
      displayName: undefined,
      deps: undefined,
      parent: undefined,
      callerTerminalHandle: 'term_creator'
    })
  })

  it('does not persist a stale env terminal handle as task creator', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_stale'
    callMock
      .mockRejectedValueOnce(
        new RuntimeClientError('terminal_handle_stale', 'terminal_handle_stale')
      )
      .mockResolvedValueOnce({ result: { task: { id: 'task_1', status: 'ready' } } })
    getTerminalHandleMock.mockRejectedValue(
      new RuntimeClientError('no_active_terminal', 'no_active_terminal')
    )

    await invokeTaskCreate(new Map<string, string | boolean>([['spec', 'do work']]))

    expect(callMock).toHaveBeenNthCalledWith(1, 'terminal.show', { terminal: 'term_stale' })
    expect(callMock).toHaveBeenNthCalledWith(2, 'orchestration.taskCreate', {
      spec: 'do work',
      taskTitle: undefined,
      displayName: undefined,
      deps: undefined,
      parent: undefined,
      callerTerminalHandle: undefined
    })
  })

  it('propagates unexpected active fallback failures after a stale env handle', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_stale'
    callMock.mockRejectedValueOnce(
      new RuntimeClientError('terminal_handle_stale', 'terminal_handle_stale')
    )
    getTerminalHandleMock.mockRejectedValue(
      new RuntimeClientError('runtime_unavailable', 'runtime_unavailable')
    )

    await expect(
      invokeTaskCreate(new Map<string, string | boolean>([['spec', 'do work']]))
    ).rejects.toMatchObject({
      code: 'runtime_unavailable'
    })

    expect(callMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the active terminal when a stale env handle has a live replacement', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_stale'
    callMock
      .mockRejectedValueOnce(
        new RuntimeClientError('terminal_handle_stale', 'terminal_handle_stale')
      )
      .mockResolvedValueOnce({ result: { task: { id: 'task_1', status: 'ready' } } })
    getTerminalHandleMock.mockResolvedValue('term_live')

    await invokeTaskCreate(new Map<string, string | boolean>([['spec', 'do work']]))

    expect(callMock).toHaveBeenNthCalledWith(1, 'terminal.show', { terminal: 'term_stale' })
    expect(callMock).toHaveBeenNthCalledWith(2, 'orchestration.taskCreate', {
      spec: 'do work',
      taskTitle: undefined,
      displayName: undefined,
      deps: undefined,
      parent: undefined,
      callerTerminalHandle: 'term_live'
    })
  })
})

describe('orchestration timeout flag validation', () => {
  const invalidTimeoutValues: [string, string | boolean][] = [
    ['missing', true],
    ['empty', ''],
    ['non-numeric', 'not-a-number'],
    ['zero', '0'],
    ['negative', '-1']
  ]

  beforeEach(() => {
    callMock.mockReset()
    delete process.env.ORCA_TERMINAL_HANDLE
  })

  const invokeCheck = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration check']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  const invokeAsk = (flags: Map<string, string | boolean>) =>
    ORCHESTRATION_HANDLERS['orchestration ask']({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json: true
    } as never)

  it.each(invalidTimeoutValues)('rejects invalid check --timeout-ms: %s', async (_label, value) => {
    const flags = new Map<string, string | boolean>([
      ['wait', true],
      ['timeout-ms', value]
    ])

    await expect(invokeCheck(flags)).rejects.toThrow(/--timeout-ms/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('passes a parsed check timeout into the RPC payload', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_worker'
    callMock.mockResolvedValue({ result: { messages: [], count: 0 } })

    await invokeCheck(
      new Map<string, string | boolean>([
        ['wait', true],
        ['timeout-ms', '250']
      ])
    )

    expect(callMock).toHaveBeenCalledWith('orchestration.check', {
      terminal: 'term_worker',
      unread: undefined,
      all: undefined,
      types: undefined,
      inject: undefined,
      wait: true,
      timeoutMs: 250
    })
  })

  it.each(invalidTimeoutValues)('rejects invalid ask --timeout-ms: %s', async (_label, value) => {
    const flags = new Map<string, string | boolean>([
      ['to', 'term_coord'],
      ['question', 'Proceed?'],
      ['timeout-ms', value]
    ])

    await expect(invokeAsk(flags)).rejects.toThrow(/--timeout-ms/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('uses the parsed ask timeout for both runtime wait and client timeout', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_worker'
    callMock.mockResolvedValue({
      result: {
        answer: 'yes',
        messageId: 'msg_1',
        threadId: 'thread_1',
        timedOut: false
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await invokeAsk(
      new Map<string, string | boolean>([
        ['to', 'term_coord'],
        ['question', 'Proceed?'],
        ['timeout-ms', '123']
      ])
    )

    expect(callMock).toHaveBeenCalledWith(
      'orchestration.ask',
      {
        to: 'term_coord',
        question: 'Proceed?',
        options: undefined,
        timeoutMs: 123,
        from: 'term_worker'
      },
      { timeoutMs: 5_123 }
    )
  })
})
