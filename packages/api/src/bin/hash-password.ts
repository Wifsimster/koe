import { hashPassword } from '../lib/password';

/**
 * Generate an argon2id hash to paste into ADMIN_PASSWORD_HASH.
 *
 *   docker compose run --rm api hash-password 'my-strong-password'
 *
 * Prints the hash to stdout. Wrap it in single quotes when pasting
 * into `.env` so the `$argon2id$…` segments aren't interpreted by
 * the shell.
 */
async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: hash-password <password>');
    process.exit(2);
  }
  const hash = await hashPassword(password);
  console.log(hash);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
