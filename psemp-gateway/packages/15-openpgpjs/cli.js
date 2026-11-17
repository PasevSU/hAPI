#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const usage = `OpenPGP.js CLI (OpenPGP.js 6.3.1)

Commands:
  keygen --name NAME --email EMAIL [--out PREFIX] [--no-passphrase]
  inspect --key PUBLIC_OR_PRIVATE_KEY
  encrypt --recipient PUBLIC_KEY --input FILE --output FILE [--sign-key PRIVATE_KEY]
  decrypt --key PRIVATE_KEY --input FILE --output FILE [--verify-key PUBLIC_KEY]
  sign --key PRIVATE_KEY --input FILE --output FILE [--detached]
  verify --key PUBLIC_KEY --input FILE --signature FILE [--output FILE]
  self-test

Private-key passphrases are requested without echo in an interactive terminal.
Passphrase-protected operations require a TTY; unencrypted keys can be used non-interactively.`;

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '-h' || token === '--help') options.help = true;
    else if (token === '--detached' || token === '--no-passphrase') options[token.slice(2)] = true;
    else if (token.startsWith('--')) {
      const name = token.slice(2);
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
      if (options[name] !== undefined) throw new Error(`Option repeated: ${token}`);
      options[name] = value;
    } else if (token.startsWith('-')) throw new Error(`Unknown option: ${token}`);
    else positional.push(token);
  }
  return { positional, options };
}

async function loadOpenPGP() {
  const entry = new URL('./dist/node/openpgp.mjs', import.meta.url);
  try {
    return await import(entry.href);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
      throw new Error('OpenPGP.js has not been built. Run npm ci, then npm run build and npm run build-types in 15-openpgpjs.', { cause: error });
    }
    throw error;
  }
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('This operation needs a private-key passphrase. Run it in an interactive terminal.');
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function readPrivateKey(openpgp, file) {
  const armoredKey = fs.readFileSync(file, 'utf8');
  let privateKey = await openpgp.readPrivateKey({ armoredKey });
  if (!privateKey.isDecrypted()) {
    const passphrase = await readSecret('Private-key passphrase: ');
    privateKey = await openpgp.decryptKey({ privateKey, passphrase });
  }
  return privateKey;
}

function writeNew(file, data, mode = 0o600) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: 'wx', mode });
  return target;
}

function requireOptions(options, names) {
  const missing = names.filter((name) => !options[name]);
  if (missing.length) throw new Error(`Required option(s): ${missing.map((name) => `--${name}`).join(', ')}`);
}

async function main(args = process.argv.slice(2)) {
  const { positional, options } = parseArgs(args);
  const [command, ...extra] = positional;
  if (options.help || !command) {
    console.log(usage);
    return;
  }
  if (extra.length) throw new Error(`Unexpected argument: ${extra.join(' ')}`);
  const openpgp = await loadOpenPGP();
  let result;

  switch (command) {
    case 'keygen': {
      requireOptions(options, ['name', 'email']);
      const prefix = path.resolve(options.out || './openpgp-key');
      const passphrase = options['no-passphrase'] ? undefined : await readSecret('New private-key passphrase: ');
      if (passphrase !== undefined && passphrase.length < 12) throw new Error('Passphrase must be at least 12 characters.');
      const generated = await openpgp.generateKey({
        type: 'ecc',
        curve: 'ed25519',
        userIDs: [{ name: options.name, email: options.email }],
        ...(passphrase === undefined ? {} : { passphrase })
      });
      const privateKey = writeNew(`${prefix}.private.asc`, generated.privateKey);
      let publicKey;
      try {
        publicKey = writeNew(`${prefix}.public.asc`, generated.publicKey, 0o644);
      } catch (error) {
        fs.unlinkSync(privateKey);
        throw error;
      }
      result = { fingerprint: (await openpgp.readKey({ armoredKey: generated.publicKey })).getFingerprint(), privateKey, publicKey, passphraseProtected: passphrase !== undefined };
      break;
    }
    case 'inspect': {
      requireOptions(options, ['key']);
      const armoredKey = fs.readFileSync(options.key, 'utf8');
      const isPrivate = armoredKey.includes('BEGIN PGP PRIVATE KEY BLOCK');
      const key = isPrivate ? await openpgp.readPrivateKey({ armoredKey }) : await openpgp.readKey({ armoredKey });
      result = {
        type: isPrivate ? 'private' : 'public',
        fingerprint: key.getFingerprint(),
        keyID: key.getKeyID().toHex(),
        users: key.getUserIDs(),
        subkeys: key.getSubkeys().map((subkey) => subkey.getKeyID().toHex()),
        created: key.getCreationTime().toISOString()
      };
      break;
    }
    case 'encrypt': {
      requireOptions(options, ['recipient', 'input', 'output']);
      const recipient = await openpgp.readKey({ armoredKey: fs.readFileSync(options.recipient, 'utf8') });
      const encryptOptions = {
        message: await openpgp.createMessage({ binary: fs.readFileSync(options.input) }),
        encryptionKeys: [recipient],
        format: 'armored'
      };
      if (options['sign-key']) encryptOptions.signingKeys = [await readPrivateKey(openpgp, options['sign-key'])];
      const armored = await openpgp.encrypt(encryptOptions);
      result = { output: writeNew(options.output, armored), bytes: Buffer.byteLength(armored), signed: Boolean(options['sign-key']) };
      break;
    }
    case 'decrypt': {
      requireOptions(options, ['key', 'input', 'output']);
      const privateKey = await readPrivateKey(openpgp, options.key);
      const decryptOptions = {
        message: await openpgp.readMessage({ armoredMessage: fs.readFileSync(options.input, 'utf8') }),
        decryptionKeys: [privateKey],
        format: 'binary'
      };
      if (options['verify-key']) {
        decryptOptions.verificationKeys = [await openpgp.readKey({ armoredKey: fs.readFileSync(options['verify-key'], 'utf8') })];
        decryptOptions.expectSigned = true;
      }
      const decrypted = await openpgp.decrypt(decryptOptions);
      for (const signature of decrypted.signatures || []) await signature.verified;
      result = { output: writeNew(options.output, Buffer.from(decrypted.data)), bytes: decrypted.data.length, signaturesVerified: (decrypted.signatures || []).length };
      break;
    }
    case 'sign': {
      requireOptions(options, ['key', 'input', 'output']);
      const privateKey = await readPrivateKey(openpgp, options.key);
      const message = await openpgp.createMessage({ binary: fs.readFileSync(options.input) });
      const signed = options.detached
        ? await openpgp.sign({ message, signingKeys: [privateKey], detached: true, format: 'armored' })
        : await openpgp.sign({ message, signingKeys: [privateKey], format: 'armored' });
      const data = typeof signed === 'string' ? signed : signed.signature;
      result = { output: writeNew(options.output, data), detached: Boolean(options.detached) };
      break;
    }
    case 'verify': {
      requireOptions(options, ['key', 'input', 'signature']);
      const key = await openpgp.readKey({ armoredKey: fs.readFileSync(options.key, 'utf8') });
      const message = await openpgp.createMessage({ binary: fs.readFileSync(options.input) });
      const signature = await openpgp.readSignature({ armoredSignature: fs.readFileSync(options.signature, 'utf8') });
      const verification = await openpgp.verify({ message, signature, verificationKeys: [key] });
      for (const item of verification.signatures) await item.verified;
      const output = options.output ? writeNew(options.output, Buffer.from(verification.data)) : undefined;
      result = { valid: verification.signatures.length > 0, signatures: verification.signatures.length, ...(output ? { output } : {}) };
      if (!result.valid) process.exitCode = 2;
      break;
    }
    case 'self-test': {
      const generated = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519', userIDs: [{ name: 'OpenPGP CLI test', email: 'test@example.invalid' }] });
      const publicKey = await openpgp.readKey({ armoredKey: generated.publicKey });
      const privateKey = await openpgp.readPrivateKey({ armoredKey: generated.privateKey });
      const original = 'OpenPGP.js CLI self-test';
      const encrypted = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: original }),
        encryptionKeys: [publicKey],
        signingKeys: [privateKey]
      });
      const message = await openpgp.readMessage({ armoredMessage: encrypted });
      const decrypted = await openpgp.decrypt({ message, decryptionKeys: [privateKey], verificationKeys: [publicKey], expectSigned: true });
      for (const signature of decrypted.signatures) await signature.verified;
      if (decrypted.data !== original) throw new Error('OpenPGP round-trip returned different plaintext.');
      result = { ok: true, version: '6.3.1', fingerprint: publicKey.getFingerprint(), signedAndEncryptedRoundTrip: true };
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}\n${usage}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`openpgp: ${error.message}`);
  process.exitCode = 1;
});