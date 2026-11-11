// One date and time format for the whole interface.
//
// Screens were mixing `toLocaleString()` ("11/12/2026, 7:24:14 AM") with
// `toLocaleDateString()` ("11/11/2026"), so the same exam read differently depending on
// where you saw it, and seconds appeared in places a person never needs them. An
// examination is scheduled to the minute, never to the second.
//
// Deliberately uses en-GB day-month order with a short month name: "12 Nov 2026" cannot be
// misread, where "11/12/2026" means two different days on two sides of the world — and
// this platform is used in India, where the US order is not the local convention.

const DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

type Dateish = Date | string | number | null | undefined;

function toDate(value: Dateish): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "12 Nov 2026" */
export function formatDate(value: Dateish, fallback = '—'): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-GB', DATE) : fallback;
}

/** "14:30" — 24-hour, because an exam timetable is read against a clock, not a meridiem. */
export function formatTime(value: Dateish, fallback = '—'): string {
  const d = toDate(value);
  return d ? d.toLocaleTimeString('en-GB', TIME) : fallback;
}

/** "12 Nov 2026, 14:30" */
export function formatDateTime(value: Dateish, fallback = '—'): string {
  const d = toDate(value);
  return d ? `${d.toLocaleDateString('en-GB', DATE)}, ${d.toLocaleTimeString('en-GB', TIME)}` : fallback;
}
