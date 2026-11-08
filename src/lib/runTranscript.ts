// How a program run is turned into plain text — shared by the browser terminal (which
// offers the last run to the answer sheet) and the execution engine (which persists every
// run as an ExecutionRecord). Dependency-free so both can import it.
//
// Keeping ONE implementation is the point: the evaluator compares the student's Output
// section against recorded runs, and that comparison is only meaningful if both sides were
// produced by the same rules.

/** Max characters stored per field of an ExecutionRecord. A run may print up to 5 MB. */
export const RECORD_FIELD_LIMIT = 64 * 1024;

export const TRUNCATION_MARKER = '\n[… truncated by LabSubmit]';

// xterm renders ANSI; a lab record should not contain escape codes. Strips CSI/OSC
// sequences and normalises CRLF, leaving the plain text a student would write down.
export function stripAnsi(input: string): string {
  return (
    input
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[@-Z\\-_]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  );
}

/**
 * Applies one chunk of terminal input to the reconstructed stdin: backspace deletes, Enter
 * becomes a newline, other control keys (arrows, escapes) are dropped. Processed per
 * character so a pasted chunk such as "3\r4\r" is captured rather than discarded.
 */
export function applyTerminalInput(stdin: string, data: string): string {
  if (data.startsWith('\x1b')) return stdin; // arrow keys, function keys: not input
  let out = stdin;
  for (const ch of data) {
    if (ch === '\x7f' || ch === '\b') out = out.slice(0, -1);
    else if (ch === '\r' || ch === '\n') out += '\n';
    // eslint-disable-next-line no-control-regex
    else if (!/[\x00-\x1f]/.test(ch)) out += ch;
  }
  return out;
}

/** Appends to a bounded buffer; once full, further text is dropped and marked. */
export function appendBounded(buffer: string, chunk: string, limit = RECORD_FIELD_LIMIT): string {
  if (buffer.length >= limit) return buffer.endsWith(TRUNCATION_MARKER) ? buffer : buffer + TRUNCATION_MARKER;
  const next = buffer + chunk;
  return next.length > limit ? next.slice(0, limit) + TRUNCATION_MARKER : next;
}

// Whitespace-insensitive at line ends and at the edges — a student copying output by hand
// or trimming a trailing newline has not changed what the program printed.
function normaliseForComparison(text: string): string {
  return stripAnsi(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Whether the text in a student's Output section is exactly what some recorded run
 * produced. Returns the matching run's index, or -1. Empty sections never "match".
 */
export function findMatchingRun(sectionText: string, runOutputs: string[]): number {
  const target = normaliseForComparison(sectionText);
  if (!target) return -1;
  return runOutputs.findIndex((out) => normaliseForComparison(out) === target);
}
