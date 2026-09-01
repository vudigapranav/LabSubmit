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
