import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configPath = path.resolve(packageRoot, '..', 'configuration.yaml');

export function loadConfiguration(file = configPath) {
  const configuration = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (configuration?.package?.id !== '05-forensics') {
    throw new Error(`Expected a 05-forensics configuration in ${file}.`);
  }
  const settings = configuration.settings;
  if (!Number.isFinite(settings?.maxEmailSizeMb) || settings.maxEmailSizeMb <= 0) {
    throw new TypeError('settings.maxEmailSizeMb must be a positive number.');
  }
  if (typeof settings.includeDecodedEmailBody !== 'boolean') {
    throw new TypeError('settings.includeDecodedEmailBody must be a boolean.');
  }
  return configuration;
}

export function getEmailEvidenceOptions(configuration = loadConfiguration()) {
  return {
    maxEmailSizeMb: configuration.settings.maxEmailSizeMb,
    includeDecodedBody: configuration.settings.includeDecodedEmailBody
  };
}
