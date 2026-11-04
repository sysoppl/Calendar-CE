// Errors of the encryption module. Messages are fixed texts: they never carry
// key material, plaintext or any other value taken from the input.

export type CryptoErrorCode = 'format' | 'version' | 'auth';

/**
 * A value that could not be sealed or opened.
 * - `format`: the input is malformed (bad base64, truncated, wrong padding, a bad argument);
 * - `version`: written with a version, suite, padding scheme or key generation this build does not know;
 * - `auth`: wrong key, wrong place (kind or context), or the data was changed.
 */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}

/**
 * Argon2 could not run at all: WebAssembly is blocked or the device ran out
 * of memory. It says nothing about the password being right or wrong.
 */
export class KdfError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KdfError';
  }
}
