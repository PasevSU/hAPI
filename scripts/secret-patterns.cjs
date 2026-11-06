'use strict';
// Общи правила за тайни, ползвани от одита (pre-push-audit) и от експорта за публикуване
// (export-tracked). Едно място, за да не се разминават двете проверки.
// Разширенията, които се сканират за тайни. `.ps1` липсваше до 0.69.87, тоест скриптовете за
// публикуване (които боравят с токени и хранилища) не се проверяваха изобщо — `pre-push-audit`
// и експортът ги подминаваха.
const TEXT_EXT = /\.(js|cjs|mjs|json|md|txt|yml|yaml|sh|py|html|css|bat|ps1|psm1|psd1|gitignore|gitattributes|prettierrc)$/i;

const SECRETS = [
  // Истински JWT има три части (header.payload.signature); тестовите fixture-и са само header.
  [/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}/, 'JWT с подпис'],
  [/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, 'частен ключ'],
  // Само ЦЯЛ блок с ключов материал е тайна; изразът „BEGIN PGP PRIVATE KEY BLOCK“
  // се среща и като текст в UI/тестове и не бива да дава фалшиви сигнали. Затова
  // между двата надписа се изисква РЕАЛЕН ключов материал: поне 100 знака от
  // base64 азбуката (тялото на armored блока). Без това изискване двата разделителя,
  // написани един след друг в код (`ui/pgp-tools.js` чете такъв блок с израз), даваха
  // фалшива тревога и одитът ставаше невъзможен за минаване.
  [/-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]{0,200}?(?:[A-Za-z0-9+/=][\s]?){100,}[\s\S]{0,200}?-----END PGP PRIVATE KEY BLOCK-----/, 'PGP частен ключ'],
  [/SUPERVISOR_TOKEN\s*=\s*\S+/, 'Supervisor токен'],
  // Без изискване за начало на ред или интервал: в код токенът стои в кавички или след `=`,
  // тоест старото `(?:^|\s)` не хващаше нито `GITHUB_TOKEN=ghp_…`, нито `'ghp_…'` — а точно
  // така изглежда течът в реален файл. Прагът от 20 знака пази от споменаване на префикса.
  [/(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/, 'GitHub токен'],
  // `AKIAIOSFODNN7EXAMPLE` е официалният пример на AWS (самото име съдържа EXAMPLE) и стои в
  // три теста за S3 огледалото. Без това изключение `npm run audit` падаше на собствената си
  // документация — тоест гейтът беше невъзможен за минаване и щеше да се пренебрегне.
  [/AKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}/, 'AWS ключ'],
];

// Имена, които никога не се публикуват, дори да не са в .gitignore. Шаблоните търсят и в
// подпапки: `^\.env` хващаше само `.env` в корена, а `config/.env` минаваше — точно файлът,
// който правилото цели да спре.
const WEIRD_NAME = [/(^|\/)\.env/, /(^|\/)admin-token$/, /\.pem$/i, /\.key$/i, /\.pfx$/i, /(^|\/)id_rsa/, /(^|\/)private\.asc$/i, /(^|\/)PGP_CryptoSAK_keys-/];

/** Първата причина файл да е забранен за публикуване, или null. */
function blockingReason(relPath, text) {
  for (const re of WEIRD_NAME) if (re.test(relPath)) return 'забранено име: ' + relPath;
  if (typeof text === 'string') for (const [re, label] of SECRETS) if (re.test(text)) return label + ': ' + relPath;
  return null;
}

module.exports = { TEXT_EXT, SECRETS, WEIRD_NAME, blockingReason };
