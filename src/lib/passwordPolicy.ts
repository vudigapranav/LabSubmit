// The one password rule, applied wherever a password is set: student self-registration,
// admin-created lecturers, admin resets and a user's own change (SECURITY_AUDIT.md S18).
// Dependency-free so the registration and profile forms can show the same rule.
//
// Deliberately modest: length is what actually resists guessing, and composition rules
// mostly produce "Password1!". The upper bound exists because bcrypt silently ignores
// everything after 72 bytes — a longer password would appear to work while only its prefix
// is checked. Existing passwords are not re-validated; this applies when one is set.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_RULE = `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters (and at most ${PASSWORD_MAX_BYTES} bytes).`;

/** Returns a message describing why the password is unacceptable, or null if it is fine. */
export function checkPasswordPolicy(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_RULE;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return PASSWORD_RULE;
  if (!password.trim()) return PASSWORD_RULE;
  return null;
}
