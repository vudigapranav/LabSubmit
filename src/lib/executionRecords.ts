// Persistence of student program runs (ExecutionRecord). Server-only (imports Prisma).
//
// Why: before this, nothing about a run was stored. Input/Output sections in the answer
// sheet were purely student-attested — a student could type output their program never
// produced. With every run recorded, the evaluator can see the run history and whether the
// submitted Output matches something that actually executed.
import { Prisma, type PrismaClient } from '@prisma/client';
import { RECORD_FIELD_LIMIT, TRUNCATION_MARKER } from './runTranscript';

/**
 * Largest source (all files of one run, in bytes) stored with a run. Source is stored whole or
 * not at all: a clipped program is not "the code that ran", and pretending otherwise would
 * mislead the evaluator. Lab programs are a few KB; this bounds a workspace's worst case.
 */
export const RECORD_SOURCE_LIMIT = 128 * 1024;

export interface RunSourceFile {
  filename: string;
  language: string;
  content: string;
}

/** Same canonical order as a hand-in snapshot, so the two can be compared file by file. */
export function runSourceForRecord(files: RunSourceFile[]): RunSourceFile[] | null {
  const canonical = files
    .map((f) => ({ filename: f.filename, language: f.language, content: f.content }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  const bytes = canonical.reduce((n, f) => n + Buffer.byteLength(f.content), 0);
  return bytes > RECORD_SOURCE_LIMIT ? null : canonical;
}

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
  /** Every source file the engine compiled for this run; null when too large to keep whole. */
  files: RunSourceFile[] | null;
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
        files: run.files ? (run.files as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
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
