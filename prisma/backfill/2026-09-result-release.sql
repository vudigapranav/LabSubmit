-- One-off, non-destructive backfill for the result-release switch (Lab.resultsReleasedAt).
--
-- Run ONCE per environment after `prisma db push` picks up the resultsReleasedAt column,
-- and only if that environment predates result-release control.
--
-- Why it is needed: before release control existed, saving a grade published it
-- immediately (the lecturer UI sent a hardcoded isPublished:true). Any environment
-- carrying such rows has published submissions under exams whose new resultsReleasedAt is
-- NULL — the exam would read "Results not released" while its students can already see
-- their marks. This reconciles the two by marking those exams as already released, dated
-- from the most recent evaluation that was published.
--
-- It is UPDATE-only: no row is deleted, no mark is changed, and no student loses access to
-- a result they can already see. It touches only labs that already have published
-- submissions and whose resultsReleasedAt is still NULL, so re-running it is a no-op.
UPDATE "Lab" l
SET "resultsReleasedAt" = COALESCE(
      l."resultsReleasedAt",
      (SELECT MAX(COALESCE(s."evaluatedAt", s."submittedAt"))
         FROM "Submission" s
        WHERE s."labId" = l.id AND s."isPublished" = true)
    )
WHERE EXISTS (SELECT 1 FROM "Submission" s WHERE s."labId" = l.id AND s."isPublished" = true)
  AND l."resultsReleasedAt" IS NULL;
