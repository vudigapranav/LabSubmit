'use client';

// Autosave for exam source files, with a local draft backup and safe crash recovery.
//
// Why: code was only sent to the server when the student pressed Run or Submit, and save
// failures were swallowed. Typing for 40 minutes without running, then refreshing — or hitting
// the deadline, whose auto-submit finalised whatever the server last had — silently lost the
// work. Manual Submit saved only the ACTIVE file, dropping edits in any other file.
//
// Rules:
//   - Every edit is saved ~1.5 s after typing stops; all dirty files, not just the active one.
//   - Responses are checked. Network/5xx failures retry with backoff; refusals the server means
//     (deadline passed, attempt submitted, file too large) are shown and NOT retried.
//   - Unsaved content is mirrored to localStorage so a crash or reload can recover it — but a
//     draft is restored only if the server copy has not changed since the draft was based on it
//     (its updatedAt). A newer server version always wins; the student is told.
//   - The server's deadline is never extended: a save that arrives after it is refused there.
import { useCallback, useEffect, useRef, useState } from 'react';
import { detectClientDeviceClass } from './useDeviceClass';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'retrying' | 'error';
/** saved: nothing left unsaved · retrying: couldn't reach the server · refused: server said no · pending: edited again mid-save */
export type FlushOutcome = 'saved' | 'retrying' | 'refused' | 'pending';

export interface AutosaveFile {
  id: string;
  content: string;
  updatedAt?: string | null;
}

interface Dirty {
  content: string;
  base: string | null; // server updatedAt this edit started from
}

interface Draft extends Dirty {
  at: number;
}

const DEBOUNCE_MS = 1500;
const MAX_BACKOFF_MS = 30_000;
const draftKey = (labId: string, fileId: string) => `labsubmit:draft:${labId}:${fileId}`;

function readDraft(labId: string, fileId: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(labId, fileId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(labId: string, fileId: string, d: Dirty) {
  try {
    window.localStorage.setItem(draftKey(labId, fileId), JSON.stringify({ ...d, at: Date.now() }));
  } catch {
    // storage full or blocked — the server save is still the primary path
  }
}
function clearDraft(labId: string, fileId: string) {
  try {
    window.localStorage.removeItem(draftKey(labId, fileId));
  } catch {}
}

export interface ReconcileResult<T extends AutosaveFile> {
  files: T[];
  restored: string[]; // file ids whose local draft was restored
  discarded: string[]; // file ids whose draft was dropped because the server copy was newer
}

/**
 * Pure decision for crash recovery: restore a local draft only when it was based on the very
 * server version we just loaded. Exported for tests.
 */
export function reconcileDraft(server: AutosaveFile, draft: Draft | null): 'restore' | 'discard' | 'none' {
  if (!draft || draft.content === server.content) return 'none';
  return draft.base !== null && draft.base === (server.updatedAt ?? null) ? 'restore' : 'discard';
}

export function useFileAutosave({ labId, token, enabled }: { labId: string; token: string | null; enabled: boolean }) {
  const dirty = useRef(new Map<string, Dirty>());
  const bases = useRef(new Map<string, string | null>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<FlushOutcome> | null>(null);
  const backoff = useRef(2000);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [message, setMessage] = useState<string | null>(null);

  const authToken = () => token || (typeof window !== 'undefined' ? window.localStorage.getItem('cbit_token') : null);

  const saveOne = useCallback(
    async (fileId: string, d: Dirty, keepalive: boolean): Promise<'ok' | 'retry' | 'refused'> => {
      try {
        const res = await fetch('/api/student/workspace', {
          method: 'POST',
          keepalive,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken()}`,
            'X-LabSubmit-Device-Class': detectClientDeviceClass(),
          },
          // The version this edit started from; the server refuses (409) if the file changed since.
          body: JSON.stringify({ action: 'save_file', labId, fileId, content: d.content, ...(d.base ? { baseUpdatedAt: d.base } : {}) }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const updatedAt: string | null = data?.file?.updatedAt ?? null;
          bases.current.set(fileId, updatedAt);
          const current = dirty.current.get(fileId);
          if (current && current.content === d.content) {
            dirty.current.delete(fileId);
            clearDraft(labId, fileId);
          } else if (current) {
            // Edited again while saving: the next save builds on the version just stored.
            current.base = updatedAt;
            writeDraft(labId, fileId, current);
          }
          return 'ok';
        }
        if (res.status >= 500) return 'retry';
        const data = await res.json().catch(() => ({}));
        setMessage(data?.error || `Save refused (${res.status}).`);
        return 'refused';
      } catch {
        return 'retry'; // offline or connection dropped
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labId, token]
  );

  /** Saves every dirty file and reports what happened. */
  const flush = useCallback(
    async (opts: { keepalive?: boolean } = {}): Promise<FlushOutcome> => {
      if (!enabled) return 'saved';
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (inFlight.current) await inFlight.current;
      if (dirty.current.size === 0) {
        setStatus('saved');
        return 'saved';
      }
      const run = (async () => {
        setStatus('saving');
        let retry = false;
        let refused = false;
        for (const [fileId, d] of Array.from(dirty.current.entries())) {
          const r = await saveOne(fileId, { ...d }, Boolean(opts.keepalive));
          if (r === 'retry') retry = true;
          if (r === 'refused') refused = true;
        }
        if (dirty.current.size === 0) {
          setStatus('saved');
          setMessage(null);
          backoff.current = 2000;
          return 'saved' as const;
        }
        if (refused) {
          setStatus('error');
          return 'refused' as const;
        }
        if (retry) {
          setStatus('retrying');
          const wait = backoff.current;
          backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
          timer.current = setTimeout(() => void flush(), wait);
          return 'retrying' as const;
        }
        setStatus('unsaved'); // edited again during the save; the debounce will pick it up
        return 'pending' as const;
      })();
      inFlight.current = run;
      try {
        return await run;
      } finally {
        inFlight.current = null;
      }
    },
    [enabled, saveOne]
  );

  /** Call on every edit. */
  const markDirty = useCallback(
    (file: AutosaveFile) => {
      if (!enabled) return;
      const base = dirty.current.get(file.id)?.base ?? bases.current.get(file.id) ?? file.updatedAt ?? null;
      const d = { content: file.content, base };
      dirty.current.set(file.id, d);
      writeDraft(labId, file.id, d);
      setStatus((s) => (s === 'error' ? s : 'unsaved'));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [enabled, labId, flush]
  );

  /** Forget a deleted file's pending edits and draft. */
  const forget = useCallback(
    (fileId: string) => {
      dirty.current.delete(fileId);
      clearDraft(labId, fileId);
    },
    [labId]
  );

  /** After loading files from the server: restore safe drafts, drop stale ones. */
  const reconcile = useCallback(
    <T extends AutosaveFile>(serverFiles: T[]): ReconcileResult<T> => {
      const restored: string[] = [];
      const discarded: string[] = [];
      const files = serverFiles.map((f) => {
        bases.current.set(f.id, f.updatedAt ?? null);
        if (!enabled) return f;
        const draft = readDraft(labId, f.id);
        const decision = reconcileDraft(f, draft);
        if (decision === 'restore') {
          restored.push(f.id);
          dirty.current.set(f.id, { content: draft!.content, base: draft!.base });
          return { ...f, content: draft!.content };
        }
        if (decision === 'discard' || (draft && draft.content === f.content)) {
          if (decision === 'discard') discarded.push(f.id);
          clearDraft(labId, f.id);
        }
        return f;
      });
      if (restored.length > 0) {
        setStatus('unsaved');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 300);
      }
      return { files, restored, discarded };
    },
    [enabled, labId, flush]
  );

  // Last chance when the tab is hidden or closed: keepalive lets the request outlive the page.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden' && dirty.current.size > 0) void flush({ keepalive: true });
    };
    const onPageHide = () => {
      if (dirty.current.size > 0) void flush({ keepalive: true });
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, flush]);

  return { status, message, markDirty, flush, forget, reconcile };
}
