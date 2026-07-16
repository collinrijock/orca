# SSH Relay Runtime Distribution — Short Implementation Checklist

Last updated: 2026-07-15

Use this file to track the project. The
[detailed evidence ledger](./2026-07-14-ssh-relay-github-release-implementation-checklist.md)
keeps commands, hashes, runner identities, timings, and failure details.

A checked box means the work has evidence in the detailed ledger. Design approval alone does not
complete a box.

Active checkpoint: **Milestone 5 / Work Package 4 desktop resolver/cache — audit the disconnected
Windows build/OpenSSH/PowerShell/.NET compatibility-evidence boundary, 2026-07-15, Codex
implementation owner.**
`E-M5-ARTIFACT-CACHE-RESOLUTION-CI-001` closes warm-cache commit
`22031fa68` on all six native clients, both Linux supplements, Windows x64 baseline, PR Checks,
Golden E2E, and computer-use; Windows arm64 remains the expected build-26200 rejection against 26100. `E-M5-ARTIFACT-CACHE-RESOLUTION-LOCAL-001` passes 9/9 purpose tests,
16/16 focused+workflow-oracle tests, 323/323 non-full-size SSH relay tests, 280/280 release-script
tests, typecheck, lint, format, reliability, max-lines, localization, and diff gates. Missing trust
and compatibility legacy results perform no cache I/O; a miss returns only the immutable selected
artifact; a verified hit acquires an in-use lease before exposure; corruption and lease failures
propagate closed. No download, Electron/startup, SSH/Beta mode/tuple/publication/default caller
exists. The active package composes only download, existing immutable cache-entry publication, and
in-use lease operations behind an explicit canonical cache root; it adds no Electron/startup,
proxy, SSH/Beta mode/tuple enablement/release publication/fallback/default behavior. SignPath stays
deferred to the final signing gate.
`E-M5-ARTIFACT-CACHE-POPULATION-AUDIT-001` selects cache-local exclusive download staging → existing
strict immutable publication → staging cleanup → in-use lease as the next boundary; the publisher
already owns strict extraction and complete-tree verification, so no second extractor is added.
`E-M5-ARTIFACT-CACHE-POPULATION-LOCAL-RED-001` records the expected missing-module failure before
implementation. `E-M5-ARTIFACT-CACHE-POPULATION-LOCAL-001` passes 9/9 purpose/integration tests,
16/16 focused+workflow-oracle tests, 332/332 non-full-size SSH relay tests, 280/280 release-script tests,
typecheck, lint, format, reliability, max-lines, localization, and diff gates. Every failure remains
unclassified and fail-closed at this layer; exact-head native proof is next.
The first real cold→warm assertion then exposed a logical `/var/...` versus physical
`/private/var/...` lease-root mismatch under `E-M5-ARTIFACT-CACHE-PHYSICAL-ROOT-LOCAL-RED-001`.
The primary plan already requires physical cache ownership, so its content is unchanged; the
implementation now canonicalizes lease identity/locking/recency to the existing physical root under
`E-M5-ARTIFACT-CACHE-PHYSICAL-ROOT-CORRECTION-LOCAL-001`: 7/7 correction tests and 21/21 focused+
workflow-oracle tests pass while missing/misplaced entries remain rejected. Broader exact-head proof
is still required before checkpointing.
Exact-head cold-cache artifact run 29475848463 then repeated the prior Windows x64 active-owner
release race in job 87548519537: the new real Linux/Windows cold→warm integration cases pass, but
lock tombstone rename receives `EPERM` and the live waiter later receives teardown `ENOENT`
(`E-M5-ARTIFACT-CACHE-LOCK-RELEASE-CI-RED-001`). The prior ledger explicitly required correction if
this recurred. The bounded sharing-error correction below is locally green, but replacement all-six
native proof remains required; do not advance to acquisition, Electron/startup, SSH, settings,
fallback, tuple, publication, or default behavior.
`E-M5-ARTIFACT-CACHE-LOCK-RELEASE-LOCAL-RED-001` records the expected missing-module failure for the
fixed bounded retry/displacement/exhaustion contract before implementation.
`E-M5-ARTIFACT-CACHE-LOCK-RELEASE-LOCAL-001` is now locally green: only `EPERM`/`EACCES` rename
failures retry for at most 5 s at 50 ms intervals; every retry rechecks exact directory/nonce
ownership, displacement preserves the successor, absent paths settle, and unexpected or exhausted
failures propagate closed. Focused plus workflow-oracle proof passes 24/24, broader non-full-size
relay proof passes 339/339 with the three declared full-size skips, release scripts pass 280/280,
and typecheck, lint, format, diff, and protected-resolver gates pass. This local evidence was not
sufficient until the replacement exact-head all-six native run and adjacent checks recorded below.
`E-M5-ARTIFACT-CACHE-LOCK-RELEASE-CI-001` now closes correction commit `bd240049f` and accepts the
cold-cache population package: all six primary native Node 24 jobs and both Linux supplements pass;
Windows x64 baseline, PR Checks, Golden E2E, and computer-use pass. Windows arm64 executes the full
runtime smoke and retains only the declared hosted build-26200 rejection against required 26100.
Every primary client passes its contract command and full-size extraction/cache lifecycle; the
repeated Windows x64 lock-release race is closed. The next package is an audit of the smallest
disconnected acquisition composition only. Electron/startup, live proxy/network, SSH, settings,
fallback, tuple enablement, release publication, and default behavior remain absent, and legacy
remains the sole production path.
`E-M5-ARTIFACT-CACHE-ACQUISITION-AUDIT-001` fixes the next narrow boundary: explicit verified
manifest/host/cache-root inputs; unavailable/compatibility short circuits; a source-qualified leased
ready result from a warm hit without download; and exactly one accepted cold-population call on a
verified miss. Final identity and cancellation are checked before exposure, with lease release on
failure. A real Linux/Windows cold→warm client-offline integration must fetch exactly once. Manifest
loading, Electron/startup, proxy policy, SSH, settings, fallback classification, tuple enablement,
publication, and defaults remain absent.
`E-M5-ARTIFACT-ACQUISITION-LOCAL-RED-001` records the expected two-suite missing-module failure for
nine purpose cases plus real Linux/Windows cold→warm client-offline integration before
implementation.
`E-M5-ARTIFACT-ACQUISITION-LOCAL-001` is green: 11/11 purpose/integration and 18/18 focused+
workflow-oracle tests pass; 350/350 non-full-size relay and 280/280 release-script tests plus
typecheck, lint, format, diff, and protected-resolver gates pass. Real Linux tar/Brotli and Windows
ZIP paths perform exactly one verified cold fetch, release the lease, then acquire warm while the
next client fetch is configured offline. Ready results are source-qualified and leased; identity,
cancellation, and all lower-layer errors fail closed without classification. The package remains
disconnected from manifest loading, Electron/startup, proxy policy, SSH, settings, fallback, tuple
enablement, publication, and defaults. Exact-head all-six native proof is recorded immediately below.
`E-M5-ARTIFACT-ACQUISITION-CI-001` closes acquisition commit `c170ff92c`: all six primary native
Node 24 jobs, both Linux supplements, Windows x64 baseline, PR Checks, Golden E2E, and computer-use
pass. Windows arm64 retains only the declared hosted build-26200 rejection against required 26100
after full runtime smoke. Every native contract command proves real Linux/Windows cold→warm client-
offline acquisition, and every full-size extraction/cache lifecycle remains inside its latency and
memory budgets. Live GitHub/CDN/proxy/certificate behavior, manifest/startup adaptation, SSH,
settings, fallback, tuple enablement, publication, and defaults remain open; legacy remains the sole
production path.
`E-M5-LIBC-DETECTION-AUDIT-001` fixes the next smallest package: one disconnected POSIX-shell,
no-Node Linux libc probe. Only complete Orca-marked `getconf GNU_LIBC_VERSION`, `ldd --version`, or
known musl-loader segments count; unmarked startup noise, incomplete/duplicate/malformed segments,
and ambiguous/conflicting candidates return unknown. Ordinary unavailable probes remain
compatibility evidence, while cancellation propagates. Kernel/libstdc++/GLIBCXX and macOS/Windows
host-evidence composition, Electron/startup, live SSH, transfer/install, settings, fallback, tuple
enablement, publication, and defaults stay absent.
`E-M5-LIBC-DETECTION-LOCAL-RED-001` records the expected one-suite/zero-test missing-module failure
before implementation; its initial 12-case contract fixes marked glibc/musl sources, noise and
malformed/duplicate/conflict rejection, unavailable-command classification, cancellation
propagation, one 15-second exec, and exact no-Node command construction. Three bounded/concatenated-
noise cases are implementation-review hardening recorded only by the later green evidence.
`E-M5-LIBC-DETECTION-LOCAL-001` passes 15/15 purpose, 46/46 focused+workflow, 365/365 non-full-size
relay, 280/280 release-script, typecheck, lint, format, reliability, max-lines, localization, diff,
and protected-resolver gates. One 15-second cancellable POSIX command prefers marked getconf,
accepts exact marked glibc/musl ldd or known-loader evidence, bounds parsed segments/lines, returns
unknown for missing/malformed/oversized/ambiguous/conflicting evidence, and propagates cancellation.
The purpose suite now runs in both native workflow families. This remains unit/contract evidence,
not live SSH or GNU/BusyBox/Alpine proof; full host composition and every production/default path
remain absent. Exact-head all-six native proof is next.
`E-M5-LIBC-DETECTION-CI-001` closes implementation commit `d8b17a354`: all six primary native Node
24 jobs, both Linux supplements, Windows x64 baseline, PR Checks, Golden E2E, and computer-use pass.
Every POSIX client passes 79 files / 532 tests and every Windows client passes 80 files / 523 tests
with 13 declared skips, including the new 15-case libc suite. Full-size extraction/cache metrics stay
inside budget. Windows arm64 completes exact-byte PTY/watcher smoke, then retains only the declared
hosted build-26200 rejection against required 26100; this is the aggregate workflow's sole failure.
Real SSH/distro behavior, remaining host evidence, composition, and every production/default path
remain open; legacy remains the sole production path.
`E-M5-LINUX-KERNEL-DETECTION-AUDIT-001` fixes the next narrow boundary: one disconnected,
15-second cancellable POSIX-shell/no-Node marked `uname -r` probe plus a kernel-only numeric-prefix
parser. Common supported Rocky/RHEL releases such as `4.18.0-553.5.1.el8_10.x86_64` currently fail
the generic parser because its suffix grammar excludes `_`; the kernel parser will admit only the
bounded distro suffix alphabet `[0-9A-Za-z._+~-]` without relaxing libc, macOS, or Windows version
parsing. Missing, noisy, incomplete, duplicate, malformed, oversized, or invalid evidence returns
unknown; ordinary probe failure remains availability evidence and cancellation propagates. The
reviewed 4.18 floor is unchanged. Host-evidence composition, product callers, live SSH/distro
proof, transfer/install, settings, fallback, tuple enablement, publication, and defaults stay
absent; legacy remains the sole production path.
`E-M5-LINUX-KERNEL-DETECTION-LOCAL-RED-001` records the expected two-file failure before
implementation: the purpose suite collects zero tests because its detection module is absent, and
the existing selector passes 24 cases but fails three Rocky/RHEL assertions. Supported and
below-floor `el8_10` releases both return `unknown-kernel`, proving the underscore suffix gap. Exact
Node 24 and all-six native execution remain required after local green.
`E-M5-LINUX-KERNEL-DETECTION-LOCAL-001` is green: 19/19 purpose tests, 60/60 focused+workflow tests,
394/394 non-full-size relay tests with three declared skips, 280/280 release-script tests, typecheck,
lint, format, reliability, max-lines, localization, diff, and protected-resolver gates pass. One
15-second cancellable marked POSIX command returns only a unique strict `uname -r`; supported
Rocky/RHEL, Ubuntu, and Alpine suffixes select against the unchanged 4.18 floor, while malformed,
oversized, noisy, unavailable, or invalid evidence returns unknown and cancellation propagates.
Libc, macOS, and PowerShell grammars remain strict. This is contract evidence, not live SSH/distro
proof; full host composition and every production/default path remain absent. Exact-head all-six
native proof is next.
`E-M5-LINUX-KERNEL-DETECTION-CI-001` closes implementation commit `d1eb0eb63`: all six primary
native Node 24 jobs, both Linux supplements, Windows x64 baseline, PR Checks, Golden E2E, and
computer-use pass. Every POSIX client passes 80 files / 561 tests and every Windows client passes 81
files / 552 tests with 13 declared skips, including the new 19-case kernel suite and strict selector
cases. Full-size extraction/cache metrics stay inside budget. Windows arm64 completes exact-byte
Node/PTY/watcher smoke, then retains only the declared hosted build-26200 rejection against required
26100; this is the aggregate workflow's sole failure. Real SSH/distro behavior, remaining host
evidence, composition, and every production/default path remain open; legacy remains the sole
production path.
`E-M5-DARWIN-VERSION-DETECTION-AUDIT-001` fixes the next smallest package: one disconnected,
15-second cancellable POSIX-shell/no-Node marked `sw_vers -productVersion` probe. Only one complete
strict two-to-four-component numeric version counts; missing, noisy, incomplete, duplicate,
malformed, suffixed, or oversized evidence returns unknown and cancellation propagates. The
reviewed macOS 13.5 floor and selector grammar stay unchanged. Rosetta/process translation, Linux
libstdc++/GLIBCXX, Windows evidence, full host composition, product callers, live SSH, transfer/
install, settings, fallback, tuple enablement, publication, and defaults remain absent.
`E-M5-DARWIN-VERSION-DETECTION-LOCAL-RED-001` records the expected missing-module failure before
implementation: the purpose suite has one failed file and zero collected tests because the audited
detection module does not exist. The native-workflow oracle now also requires that purpose suite
exactly once in both POSIX and PowerShell runner commands and remains red until they are wired.
Protected resolver files have zero diff; no production caller or default behavior is connected.
`E-M5-DARWIN-VERSION-DETECTION-LOCAL-001` is green: 21/21 purpose tests, 62/62 focused+workflow
tests, 415/415 non-full-size relay tests with three declared skips, 280/280 release-script tests,
typecheck, lint, format, max-lines, diff, and protected-resolver gates pass. One 15-second
cancellable marked POSIX command returns only a unique bounded numeric `sw_vers -productVersion`;
malformed, noisy, duplicate, unavailable, or oversized evidence returns unknown and cancellation
propagates. Both native runner families require the suite. Exact Node 24/all-six native proof is
next; real SSH/macOS, Rosetta, composition, and all production/default behavior remain absent.
`E-M5-DARWIN-VERSION-DETECTION-CI-001` closes implementation commit `bcda04389`: all six primary
native Node 24 jobs, both Linux supplements, Windows x64 baseline, PR Checks, Golden E2E, and
computer-use pass. Every native client runs the 21-case purpose suite; POSIX jobs pass 81 files /
582 tests and Windows jobs pass 82 files / 573 tests with 13 declared skips. Windows arm64 verifies
the complete 85,213,511-byte runtime plus Node/PTY/watcher/resource settlement and retains only the
known hosted build-26200 rejection against required 26100. This is contract evidence, not live SSH/
macOS or Rosetta proof; composition and every production/default path remain absent.
`E-M5-DARWIN-TRANSLATION-DETECTION-AUDIT-001` fixes the next smallest package: one disconnected,
15-second cancellable POSIX-shell/no-Node marked probe of `sysctl.proc_translated` plus
`hw.optional.arm64`. Explicit non-conflicting 1/0 values return translated/native; a missing
translation key with explicit non-arm64 hardware proves native Intel; missing/conflicting/
malformed evidence remains unknown. The detector does not change selector types or compose an
unknown into a boolean. Live Rosetta SSH remains a separate required cell; product callers,
transfer/install, settings, fallback wiring, tuple enablement, publication, and defaults stay
absent.
`E-M5-DARWIN-TRANSLATION-DETECTION-LOCAL-RED-001` records the expected missing-module failure and
the native-workflow oracle's 6/7 result before implementation. Neither runner command contains the
new suite, so its source occurrence count is one instead of three. Protected resolver files remain
untouched; no selector, composer, caller, or default behavior is connected.
`E-M5-DARWIN-TRANSLATION-DETECTION-LOCAL-001` is green: 23/23 purpose tests, 85/85 focused+workflow
tests, 438/438 non-full-size relay tests with three declared skips, 280/280 release-script tests,
typecheck, lint, format, max-lines, diff, and protected-resolver gates pass. Explicit
non-conflicting Darwin sysctl evidence returns translated/native; Intel absent-key evidence is
handled without coercing arm64-capable or unknown probe loss to native. Both native workflow
families require the suite. Exact Node 24/all-six native proof is next; live Rosetta SSH,
composition, and all production/default behavior remain absent.
`E-M5-DARWIN-TRANSLATION-DETECTION-CI-001` closes implementation commit `c8d4acb2c`: all six
primary native Node 24 jobs, both Linux supplements, Windows x64 baseline, PR Checks, Golden E2E,
and computer-use pass. POSIX clients pass 82 files / 605 tests and Windows clients pass 83 files /
596 tests with 13 declared skips, including the 23-case purpose suite. Windows arm64 verifies the
complete 85,213,511-byte runtime plus Node/PTY/watcher/resource settlement and retains only the
declared hosted build-26200 rejection against required 26100. This is contract evidence, not live
SSH/Intel/Rosetta proof; composition and every production/default path remain absent.
`E-M5-LINUX-LIBSTDCXX-DETECTION-AUDIT-001` fixes the next smallest package: one disconnected,
15-second cancellable marked Linux loader-cache probe using `ldconfig`, `readlink -f`, and bounded
binary-safe `grep -ao`. It does not require `strings`, which is absent from the audited minimal
Ubuntu image. Only complete, bounded, consistent physical libstdc++ and maximum GLIBCXX evidence
counts; loader overrides, missing tools, malformed/duplicate/overflow evidence, and conflicting
multilib candidates return unknown. Host composition, product callers, transfer/install, settings,
fallback, tuple enablement, publication, and defaults stay absent.
`E-M5-LINUX-LIBSTDCXX-DETECTION-LOCAL-RED-001` records the expected missing-module failure and the
native-workflow oracle's 6/7 result. Neither runner family contains the new suite yet; no product
caller or default behavior is connected.
`E-M5-LINUX-LIBSTDCXX-DETECTION-LOCAL-001` is green: 23/23 purpose tests, 142/142 focused+workflow
tests, 461/461 broader relay tests with three declared skips, 280/280 release-script tests,
typecheck, lint, format, max-lines, diff, and protected-resolver gates pass. The single bounded probe
refuses loader overrides, requires strict consistent loader-cache/physical-file/GLIBCXX evidence,
and has exact POSIX syntax proof without `strings` or a runtime dependency. Both native workflow
families require the suite. Exact Node 24/all-six native proof is next; host composition, live SSH,
and every production/default path remain absent.
`E-M5-LINUX-LIBSTDCXX-DETECTION-CI-RED-001` records exact-head run `29487742612`: the native Darwin
x64 job passes the new 23-case detector suite, then two dependency-injected cache unit suites collect
zero cases because their transitive Electron import attempts an uninstalled-binary network fetch.
The job exits with two failed / 81 passed files and 612 passed tests. This is a client-offline test
isolation defect; rerun-until-green is rejected. Add only purpose-scoped Electron mocks to those two
unit suites, retain real downloader/integration coverage, and repeat all-six native CI. Production
code, host composition, SSH, settings, fallback, tuple enablement, and defaults remain unchanged.
`E-M5-LINUX-LIBSTDCXX-DETECTION-CLIENT-OFFLINE-CORRECTION-LOCAL-001` is green: the two
dependency-injected cache suites now mock Electron and assert `net.fetch` is never called. Focused
proof passes 46/46, broader relay proof passes 461/461 with three declared skips, release scripts
pass 280/280, and typecheck, lint, format, max-lines, diff, and protected-resolver gates pass.
Production code remains unchanged. Replacement exact Node 24/all-six native CI is next.
`E-M5-LINUX-LIBSTDCXX-DETECTION-CI-001` closes exact head `1182bcdc5`: all six primary native Node
24 jobs, both Linux supplements, Windows x64 baseline, PR Checks, Golden E2E, and computer-use pass.
POSIX clients pass 83 files / 628 tests and Windows clients pass 84 files / 618 tests with 14
declared skips. Windows arm64 completes 60-entry/42-file/85,213,511-byte tree, Node/PTY/watcher/
resource proof and retains only the declared hosted build-26200 rejection against required 26100.
Full-size extraction/cache metrics stay inside budget. This is not live SSH/remote evidence; the
detector stays disconnected, every tuple stays disabled, and legacy remains the sole default.
`E-M5-ARTIFACT-CACHE-ROOT-CI-001` closes the pure cache-root contract at exact head `aefcaa9a9`:
all six primary native Node 24 jobs, both Linux supplements, Windows x64 baseline, PR Checks, Golden
E2E, and computer-use pass; Windows arm64 build 26200 remains correctly gated against 26100. The
startup-boundary audit found that a late direct `app.getPath('userData')` adapter would be unsafe
because `app.setName()` can change that path. The eventual startup caller must supply Orca's
pre-`app.setName()` canonical path. The next slice may only compose explicit resolver/cache
dependencies; it must add no proxy, SSH/Beta mode/tuple/publication/default behavior.
`E-M5-ARTIFACT-CACHE-ROOT-LOCAL-001` passes 3/3 purpose tests, the native
workflow oracle, 314/314 non-full-size SSH relay tests, 280/280 release-script tests, typecheck,
lint, format, reliability, max-lines, localization, and diff gates. Both POSIX and PowerShell native
artifact commands now run the purpose suite. The pure function accepts only an absolute
caller-supplied native user-data path and returns a fixed `ssh-relay-runtime-cache/v1` namespace;
an environment variable cannot redirect it. No Electron caller, filesystem I/O, cache operation,
downloader, SSH/Beta mode/tuple/publication/default behavior exists.
`E-M5-OFFICIAL-MANIFEST-COMPOSITION-CI-001` closes the official-manifest composition at exact head
`749f775f1`: all six primary native jobs, both Linux supplements, Windows x64 baseline, PR Checks,
Golden E2E, and computer-use pass; Windows arm64 build 26200 remains correctly gated against 26100.
The next slice may derive only a pure fixed cache root from an absolute caller-supplied native
user-data path; it must add no Electron caller, filesystem I/O, cache orchestration, environment
override, downloader/SSH/Beta mode/tuple/publication/default behavior.
`E-M5-OFFICIAL-MANIFEST-COMPOSITION-LOCAL-001` passes 4/4 focused, 26/26
trust, 311/311 non-full-size SSH relay, 280/280 release-script, workflow-oracle, typecheck, lint,
format, max-lines, and diff gates. An unprovisioned build returns unavailable before resource access;
provisioned trust is the only accepted-key source and binds the verified fixed-resource manifest to
its canonical key fingerprint. No resource or product consumer exists. `E-M5-COMPILED-TRUST-CI-001`
closes the prior compiled trust and stream-settlement checkpoint at exact
head `bb7493614`: all six primary native artifact jobs, both Linux supplements, Windows x64
baseline, PR Checks, Golden E2E, and unchanged computer-use retry pass. The artifact workflow is
red only because hosted Windows arm64 build 26200 correctly fails the required 26100 floor. The
next slice may compose immutable trust with the fixed-resource loader, but must add no resource,
production key/manifest, Electron/product consumer, cache/downloader, SSH, Beta mode, tuple,
publication, or default behavior. `E-M5-COMPILED-TRUST-AUDIT-001` and its RED precede
`E-M5-COMPILED-TRUST-LOCAL-001`: 3/3 focused, 22/22 trust, 307/307 non-full-size SSH relay, 279/279
release-script, workflow-oracle, typecheck, lint, format, max-lines, and diff gates pass. The build
constant is literal `null`; no production key file, resource bytes, or consumer exists. Superseded
artifact run 29470322099 exposed an unawaited
draft-upload request-stream lifecycle (`E-M5-COMPILED-TRUST-CI-RED-001`), now deterministically
reproduced and locally corrected with 9/9 focused and 280/280 release-script tests under
`E-M5-DRAFT-UPLOAD-STREAM-SETTLEMENT-LOCAL-001`. Windows x64 job 87532052082 independently failed an
existing cache-lock concurrency test with `EPERM` plus teardown `ENOENT`
(`E-M5-COMPILED-TRUST-WINDOWS-CI-RED-001`); neither failure repeated at the accepted replacement
head. Real Apple/SignPath work remains deferred to its late gate. Prior exact
head `11f367e66` passes all six primary native accepted-key jobs under
`E-M5-ACCEPTED-KEYS-CI-001` and Golden E2E; the artifact workflow is red only for the retained
Windows arm64 hosted build-26200 versus required-26100 floor gap. PR Checks attempt 1 failed one
renderer PTY ownership race in untouched code after 30,100 passes; attempt 2 has passed the complete
job, including tests, unpacked build, and packaged CLI smoke. Real Apple/SignPath rehearsal remains
a late explicit gate. The prior `E-M5-PACKAGED-MANIFEST-LOCAL-001` passes 6/6
purpose-named tests, 300/300 non-full-size SSH relay tests, 279/279 release-script tests, typecheck,
lint, format, max-lines, and diff gates. `E-M5-PACKAGED-MANIFEST-CI-WIRING-LOCAL-001` pins the suite
into both native job families; exact-head run
[29466359518](https://github.com/stablyai/orca/actions/runs/29466359518) passes the contract step and
complete primary job on Linux, macOS, and Windows, x64 and arm64, under
`E-M5-PACKAGED-MANIFEST-CI-001`. PR Checks
[29466359581](https://github.com/stablyai/orca/actions/runs/29466359581) and Golden E2E
[29466359541](https://github.com/stablyai/orca/actions/runs/29466359541) pass. No packaged resource,
production key, cache root, downloader, SSH consumer, Beta mode, tuple, publication, or default
behavior is connected. Prior exact-head run
[29464742446](https://github.com/stablyai/orca/actions/runs/29464742446) passes the lease/eviction
source contracts and exact full-size active-retention/release/eviction lifecycle on Linux, macOS,
and Windows, x64 and arm64, under `E-M5-ARTIFACT-CACHE-EVICTION-CI-001`. Retention is 11.14–47.88ms
and 0–1.99 MiB incremental RSS; eviction is 19.02–92.90ms and 0–2.08 MiB, reclaiming each exact
118.4–161.3 MB entry. PR Checks
[29464742361](https://github.com/stablyai/orca/actions/runs/29464742361) and Golden E2E
[29464742368](https://github.com/stablyai/orca/actions/runs/29464742368) pass. Prior exact-head
run [29462394311](https://github.com/stablyai/orca/actions/runs/29462394311) passes all 17 cache-entry
contracts and exact full-size cold/warm measurements on Linux, macOS, and Windows, x64 and arm64,
under `E-M5-ARTIFACT-CACHE-ENTRY-CI-001`. Cold publication is 1.17–6.17s and 34.5–48.8 MiB
incremental RSS; warm verified lookup is 0.12–0.70s and 0–6.9 MiB. PR Checks
[29462394310](https://github.com/stablyai/orca/actions/runs/29462394310) and Golden E2E
[29462394344](https://github.com/stablyai/orca/actions/runs/29462394344) pass. Windows arm64 retains
only the declared hosted build-26200 versus required-26100 floor gap after its primary runtime/cache
proof. Desktop consumers, SSH transfer/install, mode wiring, tuple enablement, publication,
production keys/environment/seed, and merge to `main` remain disconnected.

## Safety status

- [x] Existing SSH relay installation remains the default for every target.
- [x] The future bundled runtime is a per-target Beta option, off by default.
- [x] Missing, old, imported, unknown, or malformed settings select legacy behavior.
- [x] No bundled tuple is enabled and no runtime artifact is published.
- [x] Integrity, security, and corruption failures are designed to fail closed, not fall back.
- [x] Legacy removal or a default-on change requires a separate reviewed decision.

## Current gates

- [ ] **WP2 external gate — Prove oldest supported baselines and native trust.**
  - Proven: all-six target-native build/equality/smoke/metadata gates and direct payload audit.
  - Proven: exact-head run
    [29379227209](https://github.com/stablyai/orca/actions/runs/29379227209) builds both Linux tuples in
    digest-pinned Rocky 8 on native runners; both downloaded artifacts pass glibc 2.28/libstdc++
    6.0.25 execution, bundled Node, PTY, and watcher smoke.
  - Windows x64 passes its declared oldest-floor job. The hosted arm64 runner is build 26200, not the
    required build 26100, so its otherwise successful artifact/runtime smoke does not close that cell.
  - Proven: native-signing plan commit `9bdae7f5b` and CI correction `9c0357235` pass locally and on
    all six native jobs in exact-head run
    [29381495240](https://github.com/stablyai/orca/actions/runs/29381495240).
  - Proven locally and in exact-head run
    [29382772805](https://github.com/stablyai/orca/actions/runs/29382772805): credential-free exact
    signing selection, exclusive staging, returned-tree verification, and POSIX/Windows CI wiring.
  - Proven locally and in exact-head run
    [29384042509](https://github.com/stablyai/orca/actions/runs/29384042509): target-native pre-sign
    assessment and real first-build candidate staging without credentials.
  - Proven locally and in exact-head run
    [29385274738](https://github.com/stablyai/orca/actions/runs/29385274738): exact returned-file
    application into a fresh full runtime and final post-sign content identity contracts.
  - Proven locally and in exact-head run
    [29386372366](https://github.com/stablyai/orca/actions/runs/29386372366): final-tree-first,
    bounded strict-codesign and exact Node/Orca Developer ID policy contracts run under Node 24 on
    all six native jobs. This is contract proof, not proof of real Orca signatures or native trust.
  - Proven locally and in exact-head run
    [29387668264](https://github.com/stablyai/orca/actions/runs/29387668264): credential-free Windows
    final-tree-first Authenticode policy contracts execute under Node 24 on all six native jobs.
    This is contract proof, not proof of real SignPath returns or native trust.
  - Proven locally and on native x64/arm64 Windows jobs in exact-head run
    [29388734922](https://github.com/stablyai/orca/actions/runs/29388734922): official Node and both
    preserved Microsoft ConPTY files report `Valid`; downloaded reports match the exact identity,
    hashes, subjects, thumbprints, and signing-stage selection
    (`E-M3-WINDOWS-SOURCE-SIGNATURE-CI-001`). PR Checks
    [29388734935](https://github.com/stablyai/orca/actions/runs/29388734935) and Golden E2E
    [29388734914](https://github.com/stablyai/orca/actions/runs/29388734914) are green at `be32653a7`.
    The artifact workflow remains red only for the declared Windows arm64 floor mismatch (hosted
    build 26200 versus required 26100). Real SignPath returns and missing oldest-floor snapshots
    remain separately gated.
  - Next external proof: kernel 4.18, macOS 13.5, Windows arm64 build 26100, and native signing/trust.
  - No tuple is enabled; every SSH transfer/runtime and rollout cell remains open.
- [ ] **WP3 active implementation — disconnected native signing workflow locally proven.**
      Windows compatibility-kind parity is closed locally and on all six target-native jobs in
      exact-head run
      [29393022768](https://github.com/stablyai/orca/actions/runs/29393022768) under
      `E-M4-WINDOWS-MANIFEST-PARITY-LOCAL-001` and `E-M4-WINDOWS-MANIFEST-PARITY-CI-001`.
      Disconnected canonical assembly and signing-handoff modules are closed locally and on all six
      Node 24 native jobs in exact-head run
      [29395319239](https://github.com/stablyai/orca/actions/runs/29395319239) under
      `E-M4-MANIFEST-HANDOFF-CI-001`. The disconnected credential-free aggregate boundary is closed
      locally and on all six Node 24 native jobs in exact-head run
      [29397871159](https://github.com/stablyai/orca/actions/runs/29397871159) under
      `E-M4-MANIFEST-AGGREGATE-LOCAL-001`, `E-M4-MANIFEST-AGGREGATE-LOCAL-002`, and
      `E-M4-MANIFEST-AGGREGATE-CI-001`. Next, produce the exact post-sign tuple descriptor only from
      a fully verified returned runtime tree and bind it to the archive, SBOM, provenance, native
      assessment, and content identity under credential-free fail-closed tests. No production
      workflow, publication, desktop consumer, signing credential, or tuple is connected. The
      purpose-named missing-module RED is recorded under
      `E-M4-MANIFEST-TUPLE-LOCAL-RED-001`. The first implementation run exposed that both manifest
      validators incorrectly require one node-pty native file for Windows even though the proven
      closure contains `conpty.node` and `conpty_console_list.node`; correct and parity-test the exact
      per-platform role counts first (`E-M4-MANIFEST-TUPLE-SCHEMA-RED-001`). The correction,
      credential-free producer, 228-test release suite, 48-test desktop parity suite, and static gates
      are locally green under `E-M4-MANIFEST-TUPLE-LOCAL-001` and
      `E-M4-MANIFEST-TUPLE-LOCAL-002`. Exact-head run
      [29405619251](https://github.com/stablyai/orca/actions/runs/29405619251) passes the new seven-test
      tuple suite and full runtime construction on all six Node 24 native jobs under
      `E-M4-MANIFEST-TUPLE-CI-001`; PR Checks
      [29405619196](https://github.com/stablyai/orca/actions/runs/29405619196) and Golden E2E
      [29405619242](https://github.com/stablyai/orca/actions/runs/29405619242) are green. The artifact
      run is red only for the declared Windows arm64 floor mismatch (hosted build 26200 versus
      required 26100). Next, regenerate and semantically verify post-sign SBOM/provenance from the
      verified final tree. That implementation is locally green, but exact-head run
      [29408355188](https://github.com/stablyai/orca/actions/runs/29408355188) exposed a Windows x64
      test-fixture portability defect: the hardcoded Linux tar fixture cannot obtain its declared
      executable mode from a Windows filesystem, so strict archive inspection correctly rejects
      `bin/node` (`E-M4-POST-SIGN-METADATA-CI-RED-001`). The platform-native fixture correction is
      locally green across the 22-test focused suite, 233-test release suite, 48-test desktop parity
      suite, typecheck, and full lint without weakening production mode validation
      (`E-M4-POST-SIGN-METADATA-CORRECTION-LOCAL-001`). Replacement all-six exact-head evidence is
      complete in run
      [29409257513](https://github.com/stablyai/orca/actions/runs/29409257513): all six native build
      jobs pass the corrected four-test metadata suite and full artifact construction under
      `E-M4-POST-SIGN-METADATA-CI-001`. PR Checks
      [29409257568](https://github.com/stablyai/orca/actions/runs/29409257568) and Golden E2E
      [29409257636](https://github.com/stablyai/orca/actions/runs/29409257636) are green. The artifact
      run is red only for the separately declared Windows arm64 floor mismatch. The reusable native
      build prerequisite is closed locally and on all six build jobs under
      `E-M4-BUILD-PREREQUISITE-CI-001`. The next disconnected package reconstructs authenticated
      unsigned archives, signs only the exact native payload, applies returned bytes into an
      exclusive full tree, verifies native policy before PTY/watcher smoke, and regenerates the final
      archive, SBOM, provenance, and tuple descriptor. Its purpose-named RED and locally green
      implementation are recorded under `E-M4-NATIVE-SIGNING-WORKFLOW-LOCAL-RED-001` and
      `E-M4-NATIVE-SIGNING-WORKFLOW-LOCAL-001`. Exact-head native schema/contract execution is closed
      under `E-M4-NATIVE-SIGNING-WORKFLOW-CI-001`; real Apple/SignPath returned-byte/native-trust
      rehearsals remain open. Release-cut, publication, desktop consumers, and every tuple remain
      disconnected. Merging to `main` remains prohibited.

## Work packages, in required order

### WP0 — Existing Node/npm resolver correction

- [x] Implement and unit-test coherent remote Node/npm selection.
- [x] Prove live Linux arm64 SSH/PTY behavior.
- [x] Keep the fix independently reviewable from runtime distribution.
- [ ] Merge draft PR [#8724](https://github.com/stablyai/orca/pull/8724).

### WP1 — Contracts only

- [x] Define immutable signed manifests, content identity, exact asset URLs, and conservative tuple
      selection.
- [x] Add hostile manifest, schema, signature, and path tests.
- [ ] Finish archive-safety implementation and hostile archive tests.
- [ ] Update mode-qualified remote directory parsing and GC compatibility.
- [ ] Merge draft PR [#8728](https://github.com/stablyai/orca/pull/8728).

### WP2 — Target-native runtime artifacts

- [x] Pin and verify Node v24.18.0 inputs and signatures.
- [x] Build and smoke-test Node, patched `node-pty`, and `@parcel/watcher` on GitHub runners for
      Linux, macOS, and Windows on x64 and arm64.
- [x] Prove exact clean-build equality and exact runtime-tree closure on all six runner families.
- [x] Replace unpublished POSIX `.tar.xz` outputs with deterministic bounded `.tar.br` and rerun
      exact clean-build/archive/execution proof on all six native jobs
      (`E-M5-ARCHIVE-PORTABILITY-AUDIT-001` selects the correction;
      `E-M5-PORTABLE-ARCHIVE-LOCAL-RED-001` proves the old boundary fails;
      `E-M5-PORTABLE-ARCHIVE-LOCAL-001`, `E-M5-PORTABLE-ARCHIVE-PARENT-LOCAL-001`, and
      `E-M5-PORTABLE-ARCHIVE-CI-001`).
- [x] Complete the all-six SBOM, license, provenance, toolchain, and prohibited-content audit.
- [x] Rebuild both Linux artifacts in the digest-pinned glibc 2.28/libstdc++ 6.0.25 userland on
      native x64/arm64 runners; smoke and compare them there. (`E-M3-LINUX-NATIVE-USERLAND-CI-001`)
- [ ] Prove each candidate on its oldest supported OS/libc/kernel baseline.
- [ ] Sign macOS and Windows bytes and verify native trust on the target OS.
- [ ] Merge draft PR [#8741](https://github.com/stablyai/orca/pull/8741).

### WP3 — Release build and signing

- [x] Release/signing DAG contracts pass locally and on all six native build jobs under
      `E-M4-RELEASE-DAG-LOCAL-001` and `E-M4-RELEASE-DAG-CI-001`.
- [x] Aggregate-input and authenticated draft read-back verification pass locally and on all six
      native build jobs under `E-M4-AGGREGATE-READBACK-LOCAL-001` and
      `E-M4-AGGREGATE-READBACK-CI-001`.
- [x] Correct the Windows compatibility discriminator and `bin/node.exe` manifest parity; prove both
      regenerated Windows identities and all-six native regressions
      (`E-M4-WINDOWS-MANIFEST-PARITY-LOCAL-001`, `E-M4-WINDOWS-MANIFEST-PARITY-CI-001`).
- [x] Add disconnected canonical unsigned
      manifest assembly, a bounded signing request, and returned-signature verification. Keep final
      detached-signature asset encoding, production credentials, publication, desktop consumers, and
      every tuple outside this slice until their contracts and gates are explicit. Purpose-named RED
      and GREEN suites plus broad local regressions are recorded under
      `E-M4-MANIFEST-HANDOFF-LOCAL-RED-001`, `E-M4-MANIFEST-HANDOFF-LOCAL-001`, and
      `E-M4-MANIFEST-HANDOFF-LOCAL-002`; all-six Node 24 proof is recorded under
      `E-M4-MANIFEST-HANDOFF-CI-001`.
- [x] Add the disconnected, credential-free
      fail-closed aggregate boundary from exact verified runtime inputs through canonical request and
      verified final-manifest bytes. Keep native/manifest credentials, publication, desktop
      consumers, and every tuple outside this slice
      (`E-M4-MANIFEST-AGGREGATE-LOCAL-001`, `E-M4-MANIFEST-AGGREGATE-LOCAL-002`,
      `E-M4-MANIFEST-AGGREGATE-CI-001`).
- [x] Add the credential-free post-sign
      tuple-descriptor producer and native-verification handoff needed to supply the aggregate.
      Derive it only from a fully verified returned runtime tree; keep real signing, publication,
      desktop consumers, and every tuple outside this slice. The missing-module RED is recorded under
      `E-M4-MANIFEST-TUPLE-LOCAL-RED-001`. Before GREEN, correct release/desktop tuple-role
      cardinality for the real Windows closure under `E-M4-MANIFEST-TUPLE-SCHEMA-RED-001`. Code and
      local proof are complete under `E-M4-MANIFEST-TUPLE-LOCAL-001` and
      `E-M4-MANIFEST-TUPLE-LOCAL-002`; all-six exact-head Node 24 proof is recorded under
      `E-M4-MANIFEST-TUPLE-CI-001`.
- [x] Regenerate SBOM and provenance from
      the verified post-sign runtime tree and semantically bind both outputs to the final content
      identity before tuple assembly. Keep credentials, publication, desktop consumers, and every
      tuple disconnected. The purpose-named missing-module RED is recorded under
      `E-M4-POST-SIGN-METADATA-LOCAL-RED-001`. The implementation, semantic tuple-consumer gate,
      233-test release suite, 48-test desktop parity suite, and static gates are locally green under
      `E-M4-POST-SIGN-METADATA-LOCAL-001` and `E-M4-POST-SIGN-METADATA-LOCAL-002`; exact-head Node 24
      execution on all six native jobs is required before this item closes. Windows x64 job
      [87329210635](https://github.com/stablyai/orca/actions/runs/29408355188/job/87329210635)
      is the required CI RED: its filesystem cannot create the hardcoded Linux tar fixture's
      executable mode, and strict archive inspection rejects `bin/node`
      (`E-M4-POST-SIGN-METADATA-CI-RED-001`). The test-fixture-only correction now selects the exact
      native tuple/archive family on each runner and is locally green under
      `E-M4-POST-SIGN-METADATA-CORRECTION-LOCAL-001`; production type/mode validation is unchanged.
      Exact-head execution passes on all six native jobs under
      `E-M4-POST-SIGN-METADATA-CI-001`.
- [x] Add a reusable target-native runtime
      build prerequisite contract. Keep it disconnected from release-cut and every desktop build
      until exact floors, native signing/trust, aggregate, and publication gates are complete; no
      tuple is enabled by this slice. The purpose-named RED proves `workflow_call` was absent; the
      credential-free interface and both native test-family integrations are locally green while
      both release workflows remain disconnected (`E-M4-BUILD-PREREQUISITE-LOCAL-RED-001`,
      `E-M4-BUILD-PREREQUISITE-LOCAL-001`, `E-M4-BUILD-PREREQUISITE-CI-001`).
- [ ] **In progress — 2026-07-15, Codex implementation owner:** add platform-native signing jobs;
      hash only the returned signed bytes. Begin with a purpose-named disconnected workflow RED;
      no test double counts as real signing/native-trust evidence. The workflow, authenticated
      reconstruction, bounded signing boundary, transactional finalization, and credential-free
      regression gates are locally green (`E-M4-NATIVE-SIGNING-WORKFLOW-LOCAL-RED-001`,
      `E-M4-NATIVE-SIGNING-WORKFLOW-LOCAL-001`). Exact-head native contract proof is complete; real
      protected Apple/SignPath/native-trust evidence remains required before this item can close. First
      exact-head run
      [29415080004](https://github.com/stablyai/orca/actions/runs/29415080004) is the required Windows
      CI RED: both Windows contract jobs reject two hardcoded Darwin tar fixtures because NTFS cannot
      materialize their declared executable modes, while all four POSIX native build jobs pass and
      strict production mode validation remains unchanged (`E-M4-NATIVE-SIGNING-WORKFLOW-CI-RED-001`).
      The test-only native ZIP fixture correction at `85c70c5e9` and full 241-test release suite pass
      locally. Replacement exact-head run
      [29415642475](https://github.com/stablyai/orca/actions/runs/29415642475) at `70b3892ae` is
      complete: all six target-native jobs pass the corrected contracts and full runtime build,
      smoke, equality, and upload under `E-M4-NATIVE-SIGNING-WORKFLOW-CI-001`. Both Linux userland
      supplements and Windows x64 baseline pass. The run remains red only for the separately
      declared Windows arm64 floor mismatch (hosted build 26200 versus required 26100). Golden E2E
      and PR Checks are green at the exact head. The manual credentialed rehearsal starts with the
      missing-caller RED `E-M4-NATIVE-SIGNING-REHEARSAL-LOCAL-RED-001` and is locally green under
      `E-M4-NATIVE-SIGNING-REHEARSAL-LOCAL-001`. GitHub cannot dispatch a new workflow before it
      exists on the default branch; the exact confirmation-bound refusal is recorded under
      `E-M4-NATIVE-SIGNING-REHEARSAL-DISPATCH-BLOCKED-001`, so real signing/native trust remains
      blocked without merging. Exact-head run
      [29417449971](https://github.com/stablyai/orca/actions/runs/29417449971) passes the caller and
      default-preservation contracts plus full builds on all six native jobs under
      `E-M4-NATIVE-SIGNING-REHEARSAL-CI-001`; PR Checks and Golden E2E are green. The artifact run is
      red only for the retained Windows arm64 build-26100 floor mismatch.
- [ ] Add a fail-closed aggregate and immutable manifest-signing job.
      The missing Linux aggregate-ready prerequisite is closed by
      `E-M4-LINUX-FINALIZATION-LOCAL-RED-001`, `E-M4-LINUX-FINALIZATION-LOCAL-001`, and
      `E-M4-LINUX-FINALIZATION-CI-001`: both native Linux architectures emitted inspected,
      hash-bound descriptors/receipts. The active slice is the callable, disconnected aggregate and
      protected Ed25519-signing workflow contract. The environment/seed are not provisioned, so live
      signing remains blocked and no release, desktop, publication, or tuple consumer is connected.
      The missing-workflow/seed-signer RED is
      `E-M4-PROTECTED-MANIFEST-WORKFLOW-LOCAL-RED-001`; the seed signer is locally green under
      `E-M4-PROTECTED-MANIFEST-SEED-LOCAL-001` and all-six exact-head CI is closed by
      `E-M4-PROTECTED-MANIFEST-SEED-CI-001`. The filesystem prepare/finalize command is locally
      green under `E-M4-MANIFEST-AGGREGATE-COMMAND-LOCAL-RED-001` and
      `E-M4-MANIFEST-AGGREGATE-COMMAND-LOCAL-001`, with all-six exact-head CI closed by
      `E-M4-MANIFEST-AGGREGATE-COMMAND-CI-001`. The callable workflow remains open.
      Its disconnected three-job source contract is locally green under
      `E-M4-PROTECTED-MANIFEST-WORKFLOW-LOCAL-001`, and exact-head execution passes on all six native
      jobs under `E-M4-PROTECTED-MANIFEST-WORKFLOW-CI-001`. Live protected signing remains open; no
      accepted production key, environment, or seed is provisioned.
- [x] Add the disconnected relay-specific required-asset capability. It passes locally and on all
      six native jobs under `E-M4-RELEASE-ASSETS-LOCAL-RED-001`,
      `E-M4-RELEASE-ASSETS-LOCAL-001`, and `E-M4-RELEASE-ASSETS-CI-001`. Release/default workflow
      composition remains separately gated.
- [ ] Embed the exact signed manifest and accepted keys in each desktop build.
- [ ] Upload to a draft release, read back, re-hash, and execute the downloaded archives.
      A disconnected bounded upload/recovery implementation is locally green under
      `E-M4-DRAFT-UPLOAD-LOCAL-001` and passes all six native Node 24 jobs under
      `E-M4-DRAFT-UPLOAD-CI-001`; no real release write or downloaded archive execution has occurred,
      so this item remains open. The purpose-named transactional materialization RED is recorded
      under `E-M4-DRAFT-READBACK-MATERIALIZATION-LOCAL-RED-001`; one-pass persistence, exclusive
      temporary/final naming, cancellation/failure cleanup, and exact returned paths pass locally
      under `E-M4-DRAFT-READBACK-MATERIALIZATION-LOCAL-001`. Exact-head all-six Node 24 proof is
      closed under `E-M4-DRAFT-READBACK-MATERIALIZATION-CI-001`; downloaded archive execution and a
      real release write/read-back are still required. The purpose-named missing execution-boundary
      RED is recorded under `E-M4-READBACK-ARCHIVE-EXECUTION-LOCAL-RED-001`. Exact descriptor/path
      binding, exclusive extraction, full-tree verification, bundled Node/native smoke, cleanup,
      and real Darwin arm64 Actions-artifact execution pass locally under
      `E-M4-READBACK-ARCHIVE-EXECUTION-LOCAL-001`. All-six exact-head Node 24 archive execution is
      closed under `E-M4-READBACK-ARCHIVE-EXECUTION-CI-001`; a real authenticated release write/
      read-back remains open.
- [ ] Test timeouts, retries, approval denial, signing failure, partial output, and draft recovery.
      Disconnected upload/materialization/execution ordering, timeout/retry/partial-output stops,
      cancellation, identity drift, ownership-safe cleanup, and later-archive failure pass locally
      under `E-M4-DRAFT-RELEASE-COMPOSITION-LOCAL-001` and on all six native Node 24 jobs under
      `E-M4-DRAFT-RELEASE-COMPOSITION-CI-001`. Protected approval and real signing failure evidence
      remain blocked/open, so this item is not complete.

### WP4 — Desktop resolver and verified cache

- [ ] Select tuples offline from the embedded manifest and resolve immutable direct asset URLs.
      The verified immutable selection and URL boundary is locally green under
      `E-M5-OFFLINE-SELECTION-LOCAL-001`. The first post-push audit found that native jobs omitted
      these source suites; both job families are now locally pinned under
      `E-M5-OFFLINE-SELECTION-CI-WIRING-LOCAL-001`, and exact-head all-six native proof is closed by
      `E-M5-OFFLINE-SELECTION-CI-001`. The disconnected fixed-resource manifest loader is locally
      green under `E-M5-PACKAGED-MANIFEST-LOCAL-001`, and both native workflow command families are
      pinned under `E-M5-PACKAGED-MANIFEST-CI-WIRING-LOCAL-001`. Exact-head all-six native source
      proof is closed by `E-M5-PACKAGED-MANIFEST-CI-001`. Production keys, signed embedded bytes,
      builder mapping, packaged-app smoke, and a consumer remain open, so this item is not complete.
- [ ] Stream bounded downloads; verify signature, size, archive hash, and extracted tree.
      The disconnected Electron downloader is locally green under
      `E-M5-ARTIFACT-DOWNLOAD-LOCAL-RED-001` and `E-M5-ARTIFACT-DOWNLOAD-LOCAL-001`; exact-head
      all-six native CI is closed under `E-M5-ARTIFACT-DOWNLOAD-CI-001`. Disconnected strict
      TAR/Brotli and ZIP extraction plus complete-tree verification are locally green under
      `E-M5-ARTIFACT-EXTRACTION-LOCAL-001`; an exact full-size Actions payload is locally within time
      and memory budgets under `E-M5-ARTIFACT-EXTRACTION-FULL-SIZE-LOCAL-001`; all-six native
      execution is closed under `E-M5-ARTIFACT-EXTRACTION-CI-001`. Packaged signature loading
      remains open.
- [x] Add exclusive staging, atomic publication, quarantine, locking, and the 2 GiB cache policy.
      Locking and immutable publication/lookup/quarantine are closed locally and on all six native
      clients under `E-M5-ARTIFACT-CACHE-LOCK-CI-001` and
      `E-M5-ARTIFACT-CACHE-ENTRY-CI-001`. In-use leases, recency, exact byte accounting, and bounded
      eviction pass locally and on all six native/full-size clients under
      `E-M5-ARTIFACT-CACHE-EVICTION-LOCAL-001` and `E-M5-ARTIFACT-CACHE-EVICTION-CI-001`.
- [ ] Prove verified cached bytes can be transferred while the client is offline.
- [ ] Preserve `ORCA_RELAY_PATH` behind the official-build trust boundary.

### WP5 — SSH transfer and remote install

- [ ] Implement bounded, cancellable SFTP transfer.
- [ ] Implement POSIX system-SSH transfer with optional tar and mandatory no-tar support.
- [ ] Implement bounded binary PowerShell/.NET transfer for Windows system SSH.
- [ ] Transfer verified bytes into exclusive staging and hash the complete staged tree with bundled
      Node before native probes.
- [ ] Prove probe → PTY/watcher smoke → sentinel → atomic publish → launch ordering.
- [ ] Trust warm installs under the immutable-directory rule; quarantine detected mutation.
- [ ] Keep SSH authentication, connection, and relay RPC transport unchanged.

### WP6 — Modes, fallback, diagnostics, and races

- [ ] Implement internal `legacy`, `auto`, and forced diagnostic `bundled` modes.
- [ ] Fall back automatically only for classified availability/compatibility failures.
- [ ] Fail closed for signature, hash, archive/tree, native-trust, bundled-Node, and cache-corruption
      failures.
- [ ] Abort and await bundled work before eligible legacy fallback begins.
- [ ] Separate bundled/legacy identities, locks, staging, sentinels, and generations.
- [ ] Test reconnect, reattach, concurrent clients, cancellation, GC, upgrades, and downgrades.

### WP7 — Per-target Beta and validation

- [ ] Add the per-target mode field with safe migration/default tests.
- [ ] Add the Beta-tagged option to SSH target add/edit UI, off by default.
- [ ] Apply a mode change only on next connection or explicit reconnect.
- [ ] Add actionable fail-closed recovery and privacy-safe Beta telemetry.
- [ ] Run every enabled remote tuple through built-in SFTP and system SSH.
- [ ] Run every supported client OS/architecture against representative POSIX and Windows remotes.
- [ ] Prove no remote GitHub egress, no-tar bootstrap, full-size transfer, slow-link cancellation,
      concurrency, RPC, and failure-injection behavior.
- [ ] Measure cold/warm latency, memory, channels/files, cancellation settlement, and fallback delay
      against legacy.
- [ ] Ship only as per-target, off-by-default Beta; gather real-host evidence before default-on review.
- [ ] Require three qualifying RCs and rollback proof before any default-on proposal.

## External blockers

- [ ] Release administrator chooses and provisions representative SSH remote snapshots, credentials,
      egress rules, teardown SLA, and cost/capacity ownership.
- [ ] Release administrator provisions protected manifest/native-signing environments, reviewers,
      test keys/certificates, and access auditing.
- [ ] After a separately authorized merge, dispatch the reviewed exact-source native-signing
      rehearsal; GitHub cannot dispatch its new workflow file while it exists only in this PR.

While blocked, artifact-only and test work may continue. No tuple may be enabled or published.

## Final go/no-go gates

- [ ] Every enabled tuple has native build, oldest-baseline, native-trust, SFTP, system-SSH, RPC,
      security, and performance evidence.
- [ ] Every desktop build embeds the signed manifest for the exact immutable assets it ships.
- [ ] Beta rollback to the existing legacy mechanism is proven in the same build.
- [ ] All required matrix cells have evidence IDs in the detailed ledger.
- [ ] Default-on receives a separate review after the Beta soak; legacy remains available until a
      separately reviewed removal decision.
