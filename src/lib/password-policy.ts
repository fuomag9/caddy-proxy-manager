/**
 * Password policy for CPM accounts. Shared by every path that sets a user
 * password (admin creation via dashboard or REST, self-service change), and
 * matching the production requirements enforced on ADMIN_PASSWORD.
 */
export const MIN_PASSWORD_LENGTH = 12;
// bcrypt only uses the first 72 bytes; the cap just bounds hashing input.
export const MAX_PASSWORD_LENGTH = 256;

/** Returns human-readable policy violations; an empty list means acceptable. */
export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`must be at most ${MAX_PASSWORD_LENGTH} characters long`);
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
    errors.push("must include both uppercase and lowercase letters");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("must include at least one number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("must include at least one special character");
  }
  return errors;
}

/** "Password must …, …" or null when the password satisfies the policy. */
export function passwordPolicyMessage(password: string, subject = "Password"): string | null {
  const errors = passwordPolicyErrors(password);
  return errors.length > 0 ? `${subject} ${errors.join(", ")}` : null;
}
