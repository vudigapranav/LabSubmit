// Persistence of student program runs (ExecutionRecord). Server-only (imports Prisma).
//
// Why: before this, nothing about a run was stored. Input/Output sections in the answer
// sheet were purely student-attested — a student could type output their program never
// produced. With every run recorded, the evaluator can see the run history and whether the
// submitted Output matches something that actually executed.
import type { PrismaClient } from '@prisma/client';
import { RECORD_FIELD_LIMIT, TRUNCATION_MARKER } from './runTranscript';

/** Oldest runs beyond this are pruned so one student cannot grow the table without bound. */
export const MAX_RECORDS_PER_WORKSPACE = 200;

export interface RunRecordInput {
  workspaceId: string;
  filename: string;
  language: string;
  stdin: string;
  /** Program output as a terminal transcript (includes echoed input). For a compile failure, the compiler diagnostics. */
  stdout: string;
  /** null when the run did not end with an exit code (stopped, disconnected, replaced). */
  exitCode: number | null;
  durationMs: number;
  compileFailed: boolean;
}

const clip = (s: string) => (s.length > RECORD_FIELD_LIMIT ? s.slice(0, RECORD_FIELD_LIMIT) + TRUNCATION_MARKER : s);

/**
 * Stores one run. Never throws: a database hiccup must not interrupt or fail the student's
 * program — the run itself matters more than its record.
 */
export async function persistExecutionRecord(prisma: PrismaClient, run: RunRecordInput): Promise<void> {
  try {
    await prisma.executionRecord.create({
      data: {
        workspaceId: run.workspaceId,
        filename: run.filename.slice(0, 200),
        language: run.language,
        stdin: clip(run.stdin),
        stdout: clip(run.stdout),
        exitCode: run.exitCode,
        durationMs: Math.max(0, Math.round(run.durationMs)),
        compileFailed: run.compileFailed,
      },
    });

    const stale = await prisma.executionRecord.findMany({
      where: { workspaceId: run.workspaceId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_RECORDS_PER_WORKSPACE,
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.executionRecord.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
    }
  } catch (err) {
    console.error('[ExecutionRecord] Failed to persist run:', err instanceof Error ? err.message : err);
  }
}
