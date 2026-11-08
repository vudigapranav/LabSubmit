// The one rule for what a workspace source filename may be. Dependency-free (no Node, no
// Prisma) so the REST workspace route, the execution engine and the browser can all share it.
//
// Why it is this strict: filenames arrive from the client on the execution WebSocket and
// are used to build filesystem paths and compiler argument lists on the execution host.
// Before this rule, `../../app/server.js` wrote outside the run's temp directory, and a
// name containing `$(...)` executed shell during compilation (SECURITY_AUDIT.md S2, S3).
// A single path segment of letters, digits, `_`, `-` and `.` is enough for every real lab
// file (main.c, Main.java, linked_list.cpp) and leaves nothing for a path or a shell to
// interpret. The engine also uses execFile and a resolved-path check — this is one layer,
// not the only one.

export const MAX_SOURCE_FILENAME_LENGTH = 100;

const SAFE_SOURCE_FILENAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export const SOURCE_FILENAME_RULE =
  'File names may only contain letters, numbers, "_", "-" and ".", must start with a letter, number or "_", and cannot contain "..".';

export function isSafeSourceFilename(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_SOURCE_FILENAME_LENGTH &&
    SAFE_SOURCE_FILENAME.test(name) &&
    !name.includes('..')
  );
}

// Size limits for an attempt's source files, shared by the workspace REST route and the
// execution engine (SECURITY_AUDIT.md S14). Generous for any lab program; they exist so an
// authenticated student cannot fill the database or the execution host's disk.
export const MAX_SOURCE_FILE_BYTES = 256 * 1024;
export const MAX_FILES_PER_WORKSPACE = 20;
