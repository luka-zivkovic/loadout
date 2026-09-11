/** Keep every issued capability format in one place, including browser-only secrets. */
export const secretPrefixes = [
  "ps",
  "psb",
  "psi",
  "psr",
  "pss",
  "psd",
] as const;
export type SecretPrefix = (typeof secretPrefixes)[number];
export const embeddedCapability = new RegExp(
  `\\b(?:${secretPrefixes.join("|")})_[a-f0-9]{64}\\b`,
);
