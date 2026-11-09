// Exam lifecycle — deterministic (frozen clock) unit tests. EXAM_LIFECYCLE_BUG_REPORT.md.
// getExamStatus/getEffectiveDeadline take `now`, so every boundary is tested to the
// millisecond without sleeping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getExamStatus, getEffectiveDeadline, getExamWindowEnd, validateExamSchedule, scheduleProblem, isPastDeadline } from '../src/lib/examTiming.ts';

const START = new Date('2026-11-09T06:14:00.000Z'); // 11:44 IST
const at = (ms) => new Date(START.getTime() + ms);
const SEC = 1000;
const MIN = 60 * SEC;
const lab = (o) => ({ isPublished: true, examModeEnabled: true, allowedLanguages: 'python', archivedAt: null, startTime: START, endTime: null, durationMinutes: null, ...o });

test('5-minute exam: every boundary', () => {
  const l = lab({ endTime: at(5 * MIN), durationMinutes: 5 });
  const cases = [
    [-MIN, 'UPCOMING', '1 minute before start'],
    [-1, 'UPCOMING', '1 ms before start'],
    [0, 'RUNNING', 'exactly at start'],
    [SEC, 'RUNNING', '1 second after start'],
    [MIN, 'RUNNING', '1 minute after start'],
    [2.5 * MIN, 'RUNNING', 'midway'],
    [5 * MIN - SEC, 'RUNNING', '1 second before the deadline'],
    [5 * MIN, 'COMPLETED', 'exactly at the deadline'],
    [5 * MIN + SEC, 'COMPLETED', '1 second after the deadline'],
  ];
  for (const [offset, expected, label] of cases) assert.equal(getExamStatus(l, at(offset)), expected, label);
});

test('180-minute exam stays RUNNING after it starts and completes only at 180 minutes', () => {
  for (const l of [lab({ durationMinutes: 180 }), lab({ endTime: at(180 * MIN), durationMinutes: 180 })]) {
    assert.equal(getExamStatus(l, at(-MIN)), 'UPCOMING');
    for (const m of [0, 1, 30, 90, 179]) assert.equal(getExamStatus(l, at(m * MIN)), 'RUNNING', `minute ${m}`);
    assert.equal(getExamStatus(l, at(180 * MIN - SEC)), 'RUNNING');
    assert.equal(getExamStatus(l, at(180 * MIN)), 'COMPLETED');
  }
});

test('the reported bug: an end time at/before the start no longer completes the exam at start', () => {
  // As stored by the old code: end == start (A) and an AM/PM slip 12 h early (B).
  const a = lab({ endTime: START, durationMinutes: 5 });
  const b = lab({ endTime: at(-12 * 60 * MIN), durationMinutes: 180 });
  assert.equal(getExamStatus(a, at(30 * SEC)), 'RUNNING', 'A was COMPLETED here before the fix');
  assert.equal(getExamStatus(a, at(5 * MIN)), 'COMPLETED');
  assert.equal(getExamStatus(b, at(2 * MIN)), 'RUNNING', 'B was COMPLETED here before the fix');
  assert.equal(getExamStatus(b, at(180 * MIN)), 'COMPLETED');
  assert.match(scheduleProblem(b), /duration instead/);
});

test('a broken stored schedule with no duration stays closed and is flagged (no silent reopening)', () => {
  const l = lab({ endTime: at(-9 * 60 * MIN), durationMinutes: null });
  assert.equal(getExamStatus(l, at(MIN)), 'COMPLETED');
  assert.match(scheduleProblem(l), /closes as soon as it starts/);
});

test('per-student deadline: min(window end, startedAt + duration), from the same window rule', () => {
  const l = lab({ endTime: at(60 * MIN), durationMinutes: 45 });
  assert.equal(getEffectiveDeadline(l, { startedAt: at(0), isSubmitted: false }).getTime(), at(45 * MIN).getTime());
  assert.equal(getEffectiveDeadline(l, { startedAt: at(30 * MIN), isSubmitted: false }).getTime(), at(60 * MIN).getTime(), 'late starter capped by window');
  const durationOnly = lab({ durationMinutes: 180 });
  assert.equal(getEffectiveDeadline(durationOnly, { startedAt: at(10 * MIN), isSubmitted: false }).getTime(), at(180 * MIN).getTime());
  assert.equal(isPastDeadline(at(5 * MIN), at(5 * MIN)), true, 'exactly at the deadline is past it');
  assert.equal(isPastDeadline(at(5 * MIN), at(5 * MIN - 1)), false);
});

test('status is the same for the same instant written in any time zone', () => {
  const ist = lab({ startTime: '2026-11-09T11:44:00+05:30', endTime: '2026-11-09T14:44:00+05:30' });
  const utc = lab({ startTime: '2026-11-09T06:14:00Z', endTime: '2026-11-09T09:14:00Z' });
  for (const now of [at(-MIN), at(MIN), at(3 * 60 * MIN)]) assert.equal(getExamStatus(ist, now), getExamStatus(utc, now));
});

test('the server process time zone does not change status or window end', () => {
  const script = `import('./src/lib/examTiming.ts').then((m) => {
    const l = { isPublished: true, examModeEnabled: true, allowedLanguages: 'python', startTime: '2026-11-09T06:14:00Z', endTime: null, durationMinutes: 180 };
    console.log(JSON.stringify([m.getExamStatus(l, new Date('2026-11-09T06:15:00Z')), m.getExamWindowEnd(l).toISOString()]));
  })`;
  const outputs = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland'].map((tz) =>
    spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).stdout.trim()
  );
  assert.ok(outputs.every((o) => o === outputs[0]), outputs.join(' | '));
  assert.equal(outputs[0], '["RUNNING","2026-11-09T09:14:00.000Z"]');
});

test('validateExamSchedule: rejects what used to break exams, accepts valid schedules', () => {
  const ok = (o) => assert.deepEqual(validateExamSchedule({ examModeEnabled: true, ...o }), [], JSON.stringify(o));
  const bad = (o, re) => assert.match(validateExamSchedule({ examModeEnabled: true, ...o }).join(' '), re, JSON.stringify(o));
  bad({ startTime: START, endTime: START, durationMinutes: 5 }, /after the start time/);
  bad({ startTime: START, endTime: at(-12 * 60 * MIN), durationMinutes: 180 }, /after the start time/);
  bad({ startTime: START, endTime: at(30 * MIN), durationMinutes: 60 }, /shorter than the duration/);
  bad({ startTime: START, endTime: null, durationMinutes: null }, /end time or a duration/);
  bad({ startTime: null, endTime: null, durationMinutes: 60 }, /start time is required/);
  bad({ startTime: START, durationMinutes: 0 }, /between 1 and/);
  bad({ startTime: START, durationMinutes: 2.5 }, /whole number/);
  ok({ startTime: START, durationMinutes: 180 }); // end time optional when a duration is given
  ok({ startTime: START, endTime: at(5 * MIN), durationMinutes: 5 });
  ok({ startTime: START, endTime: at(120 * MIN), durationMinutes: 60 }); // window longer than duration is fine
  assert.equal(getExamWindowEnd({ startTime: START, endTime: null, durationMinutes: 180 }).getTime(), at(180 * MIN).getTime());
});
