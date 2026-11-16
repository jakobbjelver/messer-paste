/**
 * A generated password people can read aloud and retype: no 0/O, 1/l/I look-alikes. 16 chars from a
 * 57-symbol alphabet is ~93 bits, which is far past what one paste needs, and the modulo bias of a
 * 32-bit draw against 57 is smaller than the risk of a typo.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generatePassword(length = 16): string {
  const draw = new Uint32Array(length);
  crypto.getRandomValues(draw);
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[draw[index] % ALPHABET.length];
  }
  return out;
}
