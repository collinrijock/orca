# Terminal Input Latency Investigation

## Finding

The strongest evidence points at the remote runtime input batcher adding user-visible latency before the PTY sees each interactive key. The local xterm path forwards `terminal.onData` directly to the transport, but the remote runtime transport used an 8 ms timer before sending the first pending input frame. That delay sits before both the host PTY write and the eventual echoed output/redraw, so it is additive to network/runtime and xterm parsing time.

Foreground output is less suspicious for the reported typing delay: visible panes call `terminal.write` immediately through `writeTerminalOutput`, while only hidden panes are throttled by the background output scheduler. Runtime graph sync, title updates, and agent-status updates are not on the input send path; they are driven by spawn/exit/title/OSC output events.

## Reference Checks

- VS Code: xterm `onData` calls `_handleOnData`, which writes through `terminalProcessManager.write` to the process without a deliberate debounce. Process output writes to xterm and acknowledges completion in the xterm write callback.
- WaveTerm: xterm `onData` calls `sendDataToController`, encoding the event payload and sending it to the controller RPC. Output appends are written to xterm through `terminal.write`.
- Tabby: xterm `onData` pushes directly into the frontend input subject, then `sendInput` feeds the session and the local/SSH session writes to the PTY/channel.
- Ghostty: key events are encoded and queued to the termio mailbox immediately; output is parsed in bulk with `nextSlice` unless the inspector slow path is active.
- cmux: the WebSocket PTY transport writes browser input as binary websocket frames directly to the PTY and sends PTY output back as binary frames, with no input debounce.

## Measurement Plan

Measure the split explicitly in a dev build:

1. Renderer key path: timestamp xterm `onData`, remote transport `sendInput`, batch flush, and `RemoteRuntimeTerminalMultiplexer.sendFrame`.
2. Host path: timestamp runtime receipt of `TerminalStreamOpcode.Input` and the PTY write return.
3. Echo/redraw path: timestamp PTY output read, output frame receive in the renderer, `outputProcessor.processData`, `writeTerminalOutput`, and xterm write callback.
4. Compare local PTY vs remote runtime with a raw shell, `stty raw -echo; od -An -t x1`, a simple echo/read loop, and Codex TUI alternate-screen redraws.
5. Track renderer pressure during Codex redraws with long-animation-frame/long-task observation and counts for title/OSC 9999/status handlers.

The regression test added for this change covers the first expected win: remote input no longer waits on a timer before the first frame, while same-turn bursts still coalesce into one binary input frame.

## Before/After Microbenchmark

The benchmark below measures the exact segment changed by this patch: `inputBatcher.push()` to the flush callback that sends the remote input frame. It compares the previous remote input setting (`delayMs = 8`) with the patched setting (`delayMs = 0`) over 500 iterations on Node 25.9.0.

| Case | Avg | P50 | P95 | P99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before, single key | 9.241 ms | 9.112 ms | 9.720 ms | 14.358 ms | 42.866 ms |
| After, single key | 0.002 ms | 0.001 ms | 0.003 ms | 0.029 ms | 0.141 ms |
| Before, same-turn `ab` burst | 9.414 ms | 9.100 ms | 10.536 ms | 17.025 ms | 54.482 ms |
| After, same-turn `ab` burst | 0.003 ms | 0.001 ms | 0.003 ms | 0.040 ms | 0.914 ms |

Result: the client-side remote input batching segment improved by about 9.1 ms at p50 and about 9.7-10.5 ms at p95, while preserving same-turn input coalescing. This proves the patch removes the user-visible fixed timer from the key-to-frame path. End-to-end Codex TUI latency still needs the live remote runtime trace above to separate PTY/network time from output redraw time.

## Remaining Architecture Benchmarks

After removing the input-side wait, the next fixed delay was the runtime output batcher. These measurements isolate the client/server architecture pieces on macOS 26.2 / Node 25.9.0:

| Segment | Avg | P50 | P95 | P99 | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Runtime output batch, old 5 ms timer, 1 chunk | 9.034 ms | 6.380 ms | 19.001 ms | 41.798 ms | Timer and event-loop jitter before output frame send |
| Runtime output batch, adaptive fast flush, 1 chunk | 0.008 ms | 0.001 ms | 0.005 ms | 0.124 ms | First small output after quiet flushes on a microtask |
| Protocol encode+decode, 1 B output frame | 0.001 ms | 0.001 ms | 0.001 ms | 0.006 ms | Binary framing is not material |
| Protocol encode+decode, 512 B output frame | 0.002 ms | 0.001 ms | 0.003 ms | 0.015 ms | Binary framing is not material |
| Protocol encode+decode, 48 KiB output frame | 0.033 ms | 0.020 ms | 0.090 ms | 0.215 ms | Still far below frame budget |
| Loopback WebSocket binary RTT, 9-12 B | 0.142 ms | 0.094 ms | 0.392 ms | 0.685 ms | Local transport floor; real remote adds actual network/runtime load |
| Local node-pty write to echoed marker | 6.792 ms | 0.052 ms | 0.280 ms | 1.994 ms | Average skewed by one startup/scheduler outlier |

Combined local PTY echo plus runtime output batching, with realistic inter-key idle gaps:

| Case | Avg | P50 | P95 | P99 |
| --- | ---: | ---: | ---: | ---: |
| Old output batch, 60 ms inter-key gap | 6.085 ms | 6.032 ms | 8.270 ms | 11.109 ms |
| Adaptive output fast flush, 60 ms inter-key gap | 1.227 ms | 0.397 ms | 4.893 ms | 26.427 ms |
| Old output batch, 120 ms inter-key gap | 19.060 ms | 6.787 ms | 47.904 ms | 330.451 ms |
| Adaptive output fast flush, 120 ms inter-key gap | 1.031 ms | 0.371 ms | 1.985 ms | 34.481 ms |

The adaptive output change keeps the old batch behavior for sustained output: in a 100-chunk synthetic stream with chunks spaced 1 ms apart, old and adaptive batching both emitted 25 frames for 10,000 bytes. That keeps throughput protection while removing the first small-output timer from the interactive echo path.

Takeaway: the client/server architecture added two fixed waits on the interactive key path: about 9 ms before input frame send and about 6 ms before the first echoed output frame. The patches remove those fixed waits while preserving same-turn input coalescing and sustained output batching. Remaining latency is likely from real transport/network delay, host PTY scheduling, and xterm parse/paint during Codex alternate-screen redraws.
