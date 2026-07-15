import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'

export type CodexTrustConfigSnapshot =
  | { existed: false }
  | { existed: true; contents: Buffer; mode: number }

export function captureCodexTrustConfig(tomlPath: string): CodexTrustConfigSnapshot {
  if (!existsSync(tomlPath)) {
    return { existed: false }
  }
  return {
    existed: true,
    contents: readFileSync(tomlPath),
    mode: statSync(tomlPath).mode
  }
}

export function restoreCodexTrustConfig(
  tomlPath: string,
  snapshot: CodexTrustConfigSnapshot
): void {
  if (!snapshot.existed) {
    if (existsSync(tomlPath)) {
      unlinkSync(tomlPath)
    }
    return
  }
  if (existsSync(tomlPath) && readFileSync(tomlPath).equals(snapshot.contents)) {
    return
  }
  writeFileSync(tomlPath, snapshot.contents, { mode: snapshot.mode })
}
