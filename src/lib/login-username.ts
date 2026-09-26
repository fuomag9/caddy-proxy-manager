/**
 * Rules for the username the login page signs in with. Better Auth's username
 * plugin applies them on sign-in, sign-up and username changes; CPM applies
 * them when it gives an account a username, so it never records one that the
 * login page would refuse. Usernames default to the account's email address.
 */
export const LOGIN_USERNAME_MIN_LENGTH = 3;
export const LOGIN_USERNAME_MAX_LENGTH = 255;

export function isValidLoginUsername(username: string): boolean {
  return (
    username.length >= LOGIN_USERNAME_MIN_LENGTH &&
    username.length <= LOGIN_USERNAME_MAX_LENGTH &&
    /^[a-zA-Z0-9_.@-]+$/.test(username)
  );
}

/**
 * Whether the login page can find an account by this stored username. Better
 * Auth lowercases what is typed and looks it up with an exact match, so a
 * stored username also has to be lowercase.
 */
export function isUsableSignInUsername(username: string | null | undefined): username is string {
  return !!username && isValidLoginUsername(username) && username === username.toLowerCase();
}

/** How many numbered variants loginUsernameCandidates offers after the first. */
const MAX_NUMBERED_CANDIDATES = 999;

/** Splits a username at its last '@' into the part before it and the rest. */
function splitAtDomain(username: string): [string, string] {
  const at = username.lastIndexOf("@");
  return at >= 0 ? [username.slice(0, at), username.slice(at)] : [username, ""];
}

/**
 * Shortens `local` so that `${local}${suffix}${domain}` fits the length limit.
 * The result is still too long when the domain alone does not fit.
 */
function fitUsername(local: string, suffix: string, domain: string): string {
  const room = LOGIN_USERNAME_MAX_LENGTH - suffix.length - domain.length;
  return `${local.slice(0, Math.max(room, 0))}${suffix}${domain}`;
}

/** Lowercases A-Z only, leaving every other character as it is. */
function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/**
 * The lowercase email when the login page accepts it as a username. Otherwise
 * each run of characters it refuses becomes '-', runs of '-' are collapsed and
 * the part before the '@' is shortened to fit the length limit, so
 * alice+cpm@example.com becomes alice-cpm@example.com. A result too short to
 * be a username falls back to "user".
 *
 * Only A-Z are lowercased and nothing but surrounding whitespace is trimmed,
 * so a refused character never simply disappears or turns into an ASCII
 * letter: +alice@example.com gives -alice@example.com and a Kelvin sign
 * gives '-', never another address's alice@example.com or 'k'.
 */
function loginUsernameBase(email: string): string {
  const lowered = asciiLowerCase(email.trim());
  if (isValidLoginUsername(lowered)) return lowered;
  const sanitized = lowered
    .replace(/[^a-z0-9_.@-]+/g, "-")
    .replace(/-{2,}/g, "-");
  const [local, domain] = splitAtDomain(sanitized);
  const fitted = domain.length < LOGIN_USERNAME_MAX_LENGTH
    ? fitUsername(local, "", domain)
    : sanitized.slice(0, LOGIN_USERNAME_MAX_LENGTH);
  return fitted.length >= LOGIN_USERNAME_MIN_LENGTH ? fitted : "user";
}

/**
 * Usernames to give an account with this email, best first: the username made
 * from the email (see loginUsernameBase), then the same with -2, -3, ... before
 * the '@' for when it is taken. Every candidate is lowercase and passes
 * isValidLoginUsername; the caller picks the first one no other account holds.
 */
export function* loginUsernameCandidates(email: string): Generator<string> {
  const base = loginUsernameBase(email);
  yield base;
  const [local, domain] = splitAtDomain(base);
  for (let n = 2; n <= MAX_NUMBERED_CANDIDATES + 1; n++) {
    const candidate = fitUsername(local, `-${n}`, domain);
    if (isValidLoginUsername(candidate)) yield candidate;
  }
}
