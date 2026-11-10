// The unified digital answer sheet.
//
// There is exactly ONE answer-sheet model for every examination. The catalogue below is
// the complete set of sections it can contain; a lecturer configures which are switched
// on, their order, their heading, whether they are mandatory and what they are worth.
// Aim / Description / Algorithm / … are NOT separate exam formats — they are rows of the
// same sheet.
//
// Pure module (no prisma import), so both route handlers and client components can share
// the catalogue and the validation rules, exactly as examTiming.ts / examIntegrity.ts do.

export type SectionContentSource = 'TEXT' | 'CODE_FILES' | 'EXECUTION_IO';

export interface SectionTemplate {
  key: string;
  label: string;
  order: number;
  enabled: boolean;
  required: boolean;
  maxMarks: number | null;
  contentSource: SectionContentSource;
  /** Shown under the heading in the lecturer's configurator. */
  hint: string;
}

export const SECTION_CATALOGUE: SectionTemplate[] = [
  {
    key: 'AIM',
    label: 'Aim',
    order: 1,
    enabled: true,
    required: true,
    maxMarks: null,
    contentSource: 'TEXT',
    hint: 'The objective of the experiment, in the student’s own words.',
  },
  {
    key: 'DESCRIPTION',
    label: 'Description',
    order: 2,
    enabled: true,
    required: false,
    maxMarks: null,
    contentSource: 'TEXT',
    hint: 'Background, theory or the problem restated.',
  },
  {
    key: 'ALGORITHM',
    label: 'Algorithm',
    order: 3,
    enabled: true,
    required: true,
    maxMarks: null,
    contentSource: 'TEXT',
    hint: 'Step-by-step logic before any code is written.',
  },
  {
    key: 'PROCEDURE',
    label: 'Procedure',
    order: 4,
    enabled: false,
    required: false,
    maxMarks: null,
    contentSource: 'TEXT',
    hint: 'The method followed during the experiment.',
  },
  {
    key: 'CODE',
    label: 'Code',
    order: 5,
    enabled: true,
    required: true,
    maxMarks: null,
    contentSource: 'CODE_FILES',
    hint: 'Taken automatically from the source files in the workspace editor.',
  },
  {
    key: 'INPUT',
    label: 'Input',
    order: 6,
    enabled: true,
    required: false,
    maxMarks: null,
    contentSource: 'EXECUTION_IO',
    hint: 'The input supplied to the program during execution.',
  },
  {
    key: 'OUTPUT',
    label: 'Output',
    order: 7,
    enabled: true,
    required: true,
    maxMarks: null,
    contentSource: 'EXECUTION_IO',
    hint: 'The output the program produced.',
  },
  {
    key: 'CONCLUSION',
    label: 'Conclusion',
    order: 8,
    enabled: true,
    required: false,
    maxMarks: null,
    contentSource: 'TEXT',
    hint: 'What the experiment established.',
  },
  {
    key: 'ITERATION',
    label: 'Iteration',
    order: 9,
    enabled: false,
    required: false,
    maxMarks: null,
    contentSource: 'TEXT',
    hint: 'Optional: refinements, retries or variations attempted.',
  },
];

const CATALOGUE_BY_KEY = new Map(SECTION_CATALOGUE.map((s) => [s.key, s]));

export function isKnownSectionKey(key: string): boolean {
  return CATALOGUE_BY_KEY.has(key);
}

export function templateForKey(key: string): SectionTemplate | undefined {
  return CATALOGUE_BY_KEY.get(key);
}

/** The format a newly created examination starts with; the lecturer edits it from there. */
export function defaultSectionConfig(): SectionTemplate[] {
  return SECTION_CATALOGUE.map((s) => ({ ...s }));
}

export interface SectionConfigInput {
  key: string;
  label?: string;
  order?: number;
  enabled?: boolean;
  required?: boolean;
  maxMarks?: number | string | null;
  contentSource?: string;
}

export interface NormalizedSection {
  key: string;
  label: string;
  order: number;
  enabled: boolean;
  required: boolean;
  maxMarks: number | null;
  contentSource: SectionContentSource;
}

/**
 * Server-side normalisation of a lecturer-submitted format. Unknown keys are dropped and
 * contentSource is always taken from the catalogue rather than the request, so a client
 * cannot turn Code into a free-text box (or vice versa) and sidestep submit validation.
 */
export function normalizeSectionConfig(input: unknown): NormalizedSection[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: NormalizedSection[] = [];

  input.forEach((raw: SectionConfigInput, index: number) => {
    if (!raw || typeof raw.key !== 'string') return;
    const key = raw.key.trim().toUpperCase();
    const template = CATALOGUE_BY_KEY.get(key);
    if (!template || seen.has(key)) return;
    seen.add(key);

    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 80) : template.label;

    let maxMarks: number | null = null;
    if (raw.maxMarks !== undefined && raw.maxMarks !== null && `${raw.maxMarks}`.trim() !== '') {
      const parsed = parseFloat(`${raw.maxMarks}`);
      maxMarks = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    out.push({
      key,
      label,
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index + 1,
      enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : template.enabled,
      required: raw.required !== undefined ? Boolean(raw.required) : template.required,
      maxMarks,
      contentSource: template.contentSource,
    });
  });

  // Re-number densely so the stored order is always 1..n in the lecturer's arrangement.
  return out
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i + 1 }));
}

export interface SectionLike {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  required: boolean;
  contentSource: string;
}

export interface ResponseLike {
  sectionId: string;
  content: string;
}

/**
 * Which mandatory sections a student has left blank. Used to block a MANUAL submit with a
 * clear message — never an automatic one: running out of time or tripping the fullscreen
 * threshold must always still submit whatever exists, incomplete or not.
 */
export function findIncompleteRequiredSections(
  sections: SectionLike[],
  responses: ResponseLike[],
  files: { content: string }[]
): string[] {
  const byId = new Map(responses.map((r) => [r.sectionId, r.content]));

  return sections
    .filter((s) => s.enabled && s.required)
    .filter((s) => {
      if (s.contentSource === 'CODE_FILES') {
        return !files.some((f) => f.content.trim().length > 0);
      }
      return !(byId.get(s.id) || '').trim();
    })
    .map((s) => s.label);
}

// ── Section-wise evaluation ─────────────────────────────────────────────────────────────
// A section is marked separately when the lecturer gave it a weighting (maxMarks) and it
// is switched on. Section marks ROLL UP into Submission.marks — the total stays the one
// field results, grades and averages read — rather than living beside it. An exam with no
// weighted sections keeps the original single flat mark (unconfigured = unchanged).

export interface GradableSectionLike {
  id: string;
  label: string;
  enabled: boolean;
  maxMarks: number | null;
}

export interface SectionMarkInput {
  sectionId: string;
  /** A number, or null/'' for "not marked yet". */
  marks: unknown;
  remarks?: unknown;
}

export interface SectionMarkEntry {
  sectionId: string;
  marks: number | null;
  remarks: string | null;
}

export interface SectionMarkResult {
  errors: string[];
  entries: SectionMarkEntry[];
  /** Sum of section marks — only when every weighted section is marked, else null. */
  total: number | null;
  /** Sum of the weighted sections' maxMarks: the submission's "out of". */
  maxTotal: number;
  complete: boolean;
}

export const MAX_REMARK_LENGTH = 2000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function gradableSections<T extends GradableSectionLike>(sections: T[]): T[] {
  return sections.filter((s) => s.enabled && typeof s.maxMarks === 'number' && s.maxMarks > 0);
}

function parseMark(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null; // not marked
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(n) ? n : undefined; // undefined = invalid
}

/**
 * Validates a lecturer's per-section marks against the exam's weighted sections and computes
 * the roll-up. Shared by the evaluate route (authoritative) and the grading panel (live
 * preview), so the total a lecturer sees is the total the server stores.
 */
export function evaluateSectionMarks(sections: GradableSectionLike[], inputs: SectionMarkInput[]): SectionMarkResult {
  const gradable = gradableSections(sections);
  const byId = new Map(gradable.map((s) => [s.id, s]));
  const errors: string[] = [];
  const entries: SectionMarkEntry[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const section = input && typeof input.sectionId === 'string' ? byId.get(input.sectionId) : undefined;
    if (!section) {
      errors.push('A mark was given for a section that is not a marked section of this examination.');
      continue;
    }
    if (seen.has(section.id)) {
      errors.push(`"${section.label}" was marked twice.`);
      continue;
    }
    seen.add(section.id);

    const marks = parseMark(input.marks);
    if (marks === undefined) {
      errors.push(`"${section.label}": marks must be a number.`);
      continue;
    }
    if (marks !== null && (marks < 0 || marks > (section.maxMarks as number))) {
      errors.push(`"${section.label}": marks must be between 0 and ${section.maxMarks}.`);
      continue;
    }
    const remarks = typeof input.remarks === 'string' && input.remarks.trim() ? input.remarks.trim() : null;
    if (remarks && remarks.length > MAX_REMARK_LENGTH) {
      errors.push(`"${section.label}": remark is longer than ${MAX_REMARK_LENGTH} characters.`);
      continue;
    }
    entries.push({ sectionId: section.id, marks: marks === null ? null : round2(marks), remarks });
  }

  const marked = new Map(entries.filter((e) => e.marks !== null).map((e) => [e.sectionId, e.marks as number]));
  const complete = gradable.length > 0 && gradable.every((s) => marked.has(s.id));
  const maxTotal = round2(gradable.reduce((sum, s) => sum + (s.maxMarks as number), 0));
  const total = complete ? round2(Array.from(marked.values()).reduce((a, b) => a + b, 0)) : null;

  return { errors, entries, total, maxTotal, complete };
}

/** The single flat mark used when an exam has no weighted sections. */
export function validateFlatMarks(value: unknown, maxMarks: number): { marks: number | null; error: string | null } {
  const marks = parseMark(value);
  if (marks === undefined) return { marks: null, error: 'Marks must be a number.' };
  if (marks !== null && (marks < 0 || marks > maxMarks)) return { marks: null, error: `Marks must be between 0 and ${maxMarks}.` };
  return { marks: marks === null ? null : round2(marks), error: null };
}

/** Largest answer-sheet section a student may save (SECURITY_AUDIT.md S14). */
export const MAX_SECTION_CONTENT_BYTES = 64 * 1024;
