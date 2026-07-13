import type { ClassifiedSkillCandidate } from './skill-management-inaccessible-candidate'

export const SKILL_CANDIDATE_SCAN_CONCURRENCY = 4

export async function runSkillCandidateTasks(
  tasks: readonly (() => Promise<ClassifiedSkillCandidate | null>)[]
): Promise<(ClassifiedSkillCandidate | null)[]> {
  const results: (ClassifiedSkillCandidate | null)[] = tasks.map(() => null)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(SKILL_CANDIDATE_SCAN_CONCURRENCY, tasks.length) },
    async () => {
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        if (index >= tasks.length) {
          return
        }
        results[index] = await tasks[index]!()
      }
    }
  )
  await Promise.all(workers)
  return results
}
