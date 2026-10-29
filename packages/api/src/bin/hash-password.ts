import { hashPassword } from '../lib/password';

function readPasswordFromTTY(): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stderr.write('Password: ');
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          resolve(buf);
          return;
        }
        if (code === 3) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          reject(new Error('interrupted'));
          return;
        }
        if (code === 127 || code === 8) {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    process.stderr.write(
      'hash-password no longer accepts the password as an argument ' +
        '(shell history / ps leak). Run it interactively or pipe the ' +
        'password on stdin.\n',
    );
    process.exit(2);
  }

  const password = process.stdin.isTTY
    ? await readPasswordFromTTY()
    : await readPasswordFromStdin();

  if (!password) {
    process.stderr.write('Empty password.\n');
    process.exit(2);
  }

  const hash = await hashPassword(password);
  process.stdout.write(hash + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(String(err instanceof Error ? err.message : err) + '\n');
    process.exit(1);
  });
}
