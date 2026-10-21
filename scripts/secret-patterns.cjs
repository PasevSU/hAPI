'use strict';
// Общи правила за тайни, ползвани от одита (pre-push-audit) и от експорта за публикуване
// (export-tracked). Едно място, за да не се разминават двете проверки.
const TEXT_EXT = /\.(js|cjs|mjs|json|md|txt|yml|yaml|sh|py|html|css|bat|gitignore|gitattributes|prettierrc)$/i;

const SECRETS = [
  // Истински JWT има три части (header.payload.signature); тестовите fixture-и са само header.
  [/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/, 'JWT с подпис'],
  [/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, 'частен ключ'],
  // Само ЦЯЛ блок с ключов материал е тайна; изразът „BEGIN PGP PRIVATE KEY BLOCK“
  // се среща и като текст в UI/тестове и не бива да дава фалшиви сигнали.
  [/-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]{100,}?-----END PGP PRIVATE KEY BLOCK-----/, 'PGP частен ключ'],
  [/SUPERVISOR_TOKEN\s*=\s*\S+/, 'Supervisor токен'],
  [/(?:^|\s)(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/, 'GitHub токен'],
  [/AKIA[0-9A-Z]{16}/, 'AWS ключ'],
];

// Имена, които никога не се публикуват, дори да не са в .gitignore.
const WEIRD_NAME = [/^\.env/, /^admin-token$/, /\.pem$/i, /\.key$/i, /\.pfx$/i, /^id_rsa/, /(^|\/)private\.asc$/i, /(^|\/)PGP_CryptoSAK_keys-/];

/** Първата причина файл да е забранен за публикуване, или null. */
function blockingReason(relPath, text) {
  for (const re of WEIRD_NAME) if (re.test(relPath)) return 'забранено име: ' + relPath;
  if (typeof text === 'string') for (const [re, label] of SECRETS) if (re.test(text)) return label + ': ' + relPath;
  return null;
}

module.exports = { TEXT_EXT, SECRETS, WEIRD_NAME, blockingReason };
