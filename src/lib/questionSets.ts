// Question sets: several variants of the same examination, one assigned at random per
// student so neighbours do not sit identical papers.
//
// The single most important rule in this module is that a STUDENT MUST NEVER LEARN WHICH
// SET THEY HOLD. Not the label, not the id, not how many sets exist, not their position in
// an ordering. `toStudentPaper()` is the only shape that may reach a student, and it is
// built by listing what a student is allowed to know rather than by deleting fields from a
// richer object — a deletion list silently fails to cover the next field someone adds.
//
// Pure module (no prisma import), shared by routes and client components exactly as
// examTiming.ts / answerSheet.ts are.

export interface QuestionInput {
  text?: string;
  marks?: number | string | null;
  order?: number;
}

export interface NormalizedQuestion {
  order: number;
  text: string;
  marks: number | null;
}

export const MAX_QUESTIONS_PER_SET = 50;
export const MAX_QUESTION_LENGTH = 5000;

/**
 * Server-side normalisation of a lecturer-submitted question list. Blank questions are
 * dropped rather than stored — an empty question would render as an unanswerable blank on a
 * student's paper.
 */
export function normalizeQuestions(input: unknown): NormalizedQuestion[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((raw: QuestionInput, index: number) => {
      const text = typeof raw?.text === 'string' ? raw.text.trim().slice(0, MAX_QUESTION_LENGTH) : '';
      let marks: number | null = null;
      if (raw?.marks !== undefined && raw.marks !== null && `${raw.marks}`.trim() !== '') {
        const parsed = parseFloat(`${raw.marks}`);
        marks = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      }
      return { order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : index + 1, text, marks };
    })
    .filter((q) => q.text.length > 0)
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_QUESTIONS_PER_SET)
    .map((q, i) => ({ ...q, order: i + 1 }));
}

export function normalizeSetLabel(label: unknown, fallback: string): string {
  return typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : fallback;
}

export interface QuestionSetLike {
  id: string;
  label: string;
  isActive: boolean;
  questions: { order: number; text: string; marks: number | null }[];
}

/** A set with no questions cannot be sat, so it is never eligible for assignment. */
export function assignableSets<T extends QuestionSetLike>(sets: T[]): T[] {
  return sets.filter((s) => s.isActive && s.questions.length > 0);
}

export interface StudentQuestion {
  order: number;
  text: string;
  marks: number | null;
}

/**
 * The ONLY question-set shape permitted in a student-facing payload.
 *
 * Note what is absent and must stay absent: the set's id, its label, how many sets the exam
 * has, and this set's position among them. `order` here is the question's place on the
 * student's own paper (1..n), which carries no information about which set it came from.
 */
export function toStudentPaper(set: QuestionSetLike | null | undefined): StudentQuestion[] {
  if (!set) return [];
  return set.questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((q, i) => ({ order: i + 1, text: q.text, marks: q.marks }));
}

/**
 * Renders a paper as the plain text the existing single-statement UI expects, so exams with
 * sets and exams without them flow through the same display path.
 */
export function paperToPlainText(questions: StudentQuestion[]): string {
  return questions.map((q) => `${q.order}. ${q.text}${q.marks !== null ? `  [${q.marks} marks]` : ''}`).join('\n\n');
}

/**
 * Picks a set for an attempt: random, but drawn from the least-used sets so a cohort ends
 * up spread evenly instead of a uniform draw leaving one set barely used.
 */
export function chooseSetId(
  sets: { id: string }[],
  usageById: Map<string, number>
): string | null {
  if (sets.length === 0) return null;
  const counts = sets.map((s) => usageById.get(s.id) || 0);
  const fewest = Math.min(...counts);
  const candidates = sets.filter((_, i) => counts[i] === fewest);
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}
