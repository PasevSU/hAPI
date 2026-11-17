import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OTS_PACKAGE = 'opentimestamps';
const CALENDAR_TIMEOUT = 20000;
const CALENDAR_MAX_RESPONSE = 10000;

let vendoredInUse = false;

function runtime() {
  try {
    vendoredInUse = false;
    return require(OTS_PACKAGE);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(`'${OTS_PACKAGE}'`)) {
      vendoredInUse = true;
      return vendoredRuntime();
    }
    throw error;
  }
}

/*
 * The bundle shipped beside this file is the BROWSER build. It probes `window` while
 * loading (its HTTP layer is request/bluebird/cookies) and registers the API on
 * `window.OpenTimestamps`, so the UMD `module.exports` comes back empty. Give it the
 * browser globals it looks for — only when absent, never overwriting — then read the
 * API back off `window`. The shims stay in place because the HTTP layer may probe
 * them lazily, long after load.
 */
function vendoredRuntime() {
  const globals = globalThis;
  const shim = (name, value) => {
    if (typeof globals[name] === 'undefined') globals[name] = value;
  };
  shim('window', globals);
  shim('self', globals);
  shim('navigator', { userAgent: 'node' });
  shim('document', { createElement: () => ({}) });

  const bundled = require('./opentimestamps.min.js');
  const candidate = bundled && bundled.Ops ? bundled : globals.window && globals.window.OpenTimestamps;
  if (!candidate || !candidate.Ops || !candidate.DetachedTimestampFile) {
    throw new Error(
      'Vendored OpenTimestamps bundle (opentimestamps.min.js) did not expose an API; ' +
        'install the npm package "opentimestamps" instead.'
    );
  }
  return candidate;
}

function timestampOptions(options = {}) {
  const ots = runtime();
  let whitelist = options.whitelist;
  if (!whitelist || typeof whitelist.add !== 'function') {
    whitelist = new ots.Calendar.UrlWhitelist();
    if (options.useDefaultWhitelist !== false) {
      for (const url of ots.Calendar.DEFAULT_CALENDAR_WHITELIST.urls) whitelist.add(url);
    }
    const extraUrls = options.whitelist == null
      ? []
      : (Array.isArray(options.whitelist) ? options.whitelist : [options.whitelist]);
    for (const url of extraUrls) whitelist.add(url);
  }
  return {
    whitelist,
    ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
    ...(options.ignoreBitcoinNode === undefined ? {} : { ignoreBitcoinNode: options.ignoreBitcoinNode }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.esplora === undefined ? {} : { esplora: options.esplora })
  };
}

/*
 * The vendored bundle ships the BROWSER HTTP layer (request + bluebird + XHR shims),
 * which cannot open a socket under Node: every submit fails with
 * "Cannot read properties of undefined (reading 'protocol')" and `stamp` then
 * silently merges nothing. Do the calendar round-trips with Node's own fetch and
 * use the bundle only for serialization, merkle tips and timestamp merging.
 */
function calendarBase(url) {
  return String(url).replace(/\/+$/, '');
}

async function calendarBytes(response, url) {
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${calendarBase(url)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > CALENDAR_MAX_RESPONSE) {
    throw new Error(`Calendar response from ${calendarBase(url)} exceeded ${CALENDAR_MAX_RESPONSE} bytes`);
  }
  return bytes;
}

function calendarTimestamp(ots, bytes, commitment) {
  const context = new ots.Context.StreamDeserialization(bytes);
  return ots.Timestamp.deserialize(context, Array.from(commitment));
}

async function submitToCalendar(ots, url, commitment) {
  const response = await fetch(`${calendarBase(url)}/digest`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.opentimestamps.v1',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: Buffer.from(commitment),
    signal: AbortSignal.timeout(CALENDAR_TIMEOUT)
  });
  return calendarTimestamp(ots, await calendarBytes(response, url), commitment);
}

async function fetchFromCalendar(ots, url, commitment) {
  const hex = Buffer.from(commitment).toString('hex');
  const response = await fetch(`${calendarBase(url)}/timestamp/${hex}`, {
    method: 'GET',
    headers: { Accept: 'application/vnd.opentimestamps.v1' },
    signal: AbortSignal.timeout(CALENDAR_TIMEOUT)
  });
  return calendarTimestamp(ots, await calendarBytes(response, url), commitment);
}

async function stampWithoutLibraryHttp(ots, detached, calendars, minimum) {
  const tip = ots.makeMerkleTree([detached]);
  if (!tip) throw new Error('Invalid input');

  const outcomes = await Promise.allSettled(calendars.map(url => submitToCalendar(ots, url, tip.msg)));
  let merged = 0;
  const failures = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled' && outcome.value) {
      tip.merge(outcome.value);
      merged++;
      return;
    }
    const reason = outcome.status === 'rejected' ? outcome.reason : null;
    failures.push(`${calendarBase(calendars[index])}: ${reason && reason.message ? reason.message : 'no timestamp returned'}`);
  });

  const required = Math.min(minimum, calendars.length);
  if (merged < required) {
    throw new Error(
      `No usable calendar attestation was returned by ${calendars.length} calendar(s); no proof was saved` +
        (failures.length ? ` (${failures.join('; ')})` : '')
    );
  }
  return merged;
}

async function upgradeWithoutLibraryHttp(ots, detached, calendars) {
  const timestamp = detached.timestamp;
  const targets = [];
  for (const subStamp of timestamp.directlyVerified()) {
    if (subStamp.isTimestampComplete()) continue;
    for (const attestation of subStamp.attestations) {
      if (!(attestation instanceof ots.Notary.PendingAttestation)) continue;
      const urls = calendars && calendars.length ? calendars : [attestation.uri];
      for (const url of urls) {
        if (!/^https?:\/\//i.test(String(url))) continue;
        targets.push({ subStamp, url, commitment: subStamp.msg });
      }
    }
  }

  const outcomes = await Promise.allSettled(
    targets.map(target => fetchFromCalendar(ots, target.url, target.commitment))
  );
  let changed = false;
  outcomes.forEach((outcome, index) => {
    if (outcome.status !== 'fulfilled' || !outcome.value) return;
    const { subStamp } = targets[index];
    if (outcome.value.getAttestations().size === 0) return;
    subStamp.merge(outcome.value);
    changed = true;
  });
  return changed;
}

function deserializeProof(otsPath, ots) {
  const bytes = fs.readFileSync(otsPath);
  try {
    return { bytes, detached: ots.DetachedTimestampFile.deserialize(bytes) };
  } catch (error) {
    throw new Error(`Invalid OpenTimestamps proof: ${otsPath}`, { cause: error });
  }
}

function temporaryPath(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
}

function writeExclusive(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = temporaryPath(file);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.linkSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function persistUpgrade(file, updated) {
  const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
  const temporary = temporaryPath(file);
  fs.writeFileSync(temporary, updated, { flag: 'wx', mode: 0o600 });
  try {
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporary, file);
    return backup;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function proofDetails(otsPath, detached, ots, verbose = false) {
  const info = ots.info(detached, { verbose });
  const text = String(info);
  const blockHeights = [...text.matchAll(/BitcoinBlockHeaderAttestation\((\d+)\)/g)]
    .map(match => Number(match[1]));
  const pendingCount = [...text.matchAll(/PendingAttestation\(/g)].length;
  const complete = /(?:Bitcoin|Litecoin|Ethereum)BlockHeaderAttestation\(\d+\)/.test(text);
  const attestationCount = [...text.matchAll(/(?:Pending|BitcoinBlockHeader|LitecoinBlockHeader|EthereumBlockHeader|Unknown)Attestation\(/g)].length;
  return {
    path: otsPath,
    fileHash: Buffer.from(detached.fileDigest()).toString('hex'),
    complete,
    pendingCount,
    attestationCount,
    blockHeights: [...new Set(blockHeights)],
    info
  };
}

export function logEvent(message, level = 'info') {
  const entry = { timestamp: new Date().toISOString(), level, message };
  console.log(`[OTS][${level}] ${message}`);
  return entry;
}

export function scanPendingOts(dir = path.resolve('data/pending')) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.ots'))
    .map(entry => path.join(dir, entry.name));
}

export function createSha256File(file) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const output = `${file}.sha256`;
  const contents = `${hash}  ${path.basename(file)}\n`;
  if (fs.existsSync(output)) {
    if (fs.readFileSync(output, 'utf8') === contents) return output;
    throw new Error(`SHA-256 sidecar already exists with different content: ${output}`);
  }
  writeExclusive(output, contents);
  return output;
}

export async function createTimestamp(file, options = {}) {
  const ots = runtime();
  const input = path.resolve(file);
  const output = path.resolve(options.outputPath || `${input}.ots`);
  if (input === output) throw new Error('Timestamp proof output must not overwrite the original file.');
  if (fs.existsSync(output)) throw new Error(`Timestamp proof already exists: ${output}`);
  const bytes = fs.readFileSync(input);
  const detached = ots.DetachedTimestampFile.fromBytes(new ots.Ops.OpSHA256(), bytes);
  const stampOptions = {
    ...timestampOptions(options),
    ...(options.calendars ? { calendars: options.calendars } : {}),
    ...(options.m ? { m: options.m } : {})
  };

  const calendars = stampOptions.calendars && stampOptions.calendars.length
    ? stampOptions.calendars
    : ots.Calendar.DEFAULT_AGGREGATORS;
  const minimum = stampOptions.m && stampOptions.m > 0
    ? stampOptions.m
    : (calendars.length >= 2 ? 2 : 1);

  if (vendoredInUse) {
    await stampWithoutLibraryHttp(ots, detached, calendars, minimum);
  } else {
    await ots.stamp(detached, stampOptions);
  }

  const details = proofDetails(output, detached, ots);
  if (details.pendingCount === 0 && !details.complete) {
    throw new Error('No usable calendar attestation was returned; no proof was saved.');
  }
  const proof = Buffer.from(detached.serializeToBytes());
  writeExclusive(output, proof);
  return {
    file: input,
    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    otsPath: output,
    status: details.complete ? 'complete' : 'pending',
    complete: details.complete,
    blockHeights: details.blockHeights,
    bytes: proof.length
  };
}

export async function upgradeTimestamp(otsPath, options = {}) {
  const ots = runtime();
  const { bytes, detached } = deserializeProof(otsPath, ots);
  const changed = vendoredInUse
    ? await upgradeWithoutLibraryHttp(ots, detached, options.calendars)
    : await ots.upgrade(detached, {
      ...timestampOptions(options),
      ...(options.calendars ? { calendars: options.calendars } : {})
    });
  const updated = Buffer.from(detached.serializeToBytes());
  const backupPath = changed && !updated.equals(bytes)
    ? persistUpgrade(otsPath, updated)
    : null;
  const details = proofDetails(otsPath, detached, ots, options.verbose);
  return {
    ...details,
    status: details.complete ? 'complete' : 'pending',
    verified: false,
    changed: Boolean(changed && !updated.equals(bytes)),
    backupPath
  };
}

export async function verifyTimestamp(otsPath, options = {}) {
  if (!fs.existsSync(otsPath)) return { verified: false, error: 'FILE_NOT_FOUND', path: otsPath };

  const ots = runtime();
  const { bytes, detached } = deserializeProof(otsPath, ots);
  let original;
  if (options.digest) {
    try {
      original = ots.DetachedTimestampFile.fromHash(
        detached.fileHashOp,
        ots.Utils.hexToBytes(options.digest)
      );
    } catch (error) {
      throw new Error(`Invalid digest for ${detached.fileHashOp._HASHLIB_NAME()}`, { cause: error });
    }
  } else {
    const originalPath = options.file || (otsPath.endsWith('.ots') ? otsPath.slice(0, -4) : '');
    if (!originalPath || !fs.existsSync(originalPath)) {
      return { verified: false, error: 'ORIGINAL_FILE_NOT_FOUND', path: originalPath || null };
    }
    original = ots.DetachedTimestampFile.fromBytes(detached.fileHashOp, fs.readFileSync(originalPath));
  }

  const attestations = await ots.verify(detached, original, {
    ...timestampOptions(options),
    ...(options.calendars ? { calendars: options.calendars } : {})
  });
  const updated = Buffer.from(detached.serializeToBytes());
  const backupPath = !updated.equals(bytes) ? persistUpgrade(otsPath, updated) : null;
  const details = proofDetails(otsPath, detached, ots, options.verbose);
  const verified = Object.keys(attestations || {}).length > 0;
  return {
    verified,
    status: verified ? 'verified' : (details.complete ? 'unverified' : 'pending'),
    attestations: attestations || {},
    ...details,
    backupPath
  };
}

export function inspectTimestamp(otsPath, options = {}) {
  const ots = runtime();
  const { detached } = deserializeProof(otsPath, ots);
  return proofDetails(otsPath, detached, ots, options.verbose);
}
