# Вградени библиотеки (vendor)

## `openpgp.min.js` — OpenPGP.js 6.3.1

| | |
| --- | --- |
| Пакет | [`openpgp`](https://www.npmjs.com/package/openpgp) 6.3.1 |
| Файл в пакета | `dist/openpgp.min.js` (UMD bundle, browser build) |
| Дата на сборката | 2026-06-04 (от банера на файла) |
| Размер | 394 512 байта |
| SHA-256 | `2de052b91cc461387a247f66c3cd46c42fc5e826634b300d760bc86ad06c730a` |
| Лиценз | **LGPL-3.0** — банерът с лиценза е запазен в първия ред |
| WASM | **не** — bundle-ът е чист JS, затова CSP не се разширява с `wasm-unsafe-eval` |

Ползва се от `ui/pgp-tools.js` (панел **PGP инструменти**). Зарежда се като
`<script src="vendor/openpgp.min.js">` преди `pgp-tools.js` и се държи като UMD модул:
в браузър слага `window.openpgp`, в Node — `new Function(src + '; return openpgp;')()`.

### Защо точно този файл

- Съвпада по поведение с `openpgp` 6.x, който add-on-ът вече ползва на сървъра
  (`pgp.js`, RFC 9580 / v6 ключове), така че клиентът и сървърът описват един и същ
  формат по един и същ начин.
- Съдържа `sourceMappingURL` коментар, който е премахнат — иначе браузърът би поискал
  `.map` файл, който не се доставя, и би записвал 404 в конзолата.
- Съдържа само browser build; няма `node:` внос, няма WASM, няма `eval` извън
  вътрешния за bundle-а код.

### Как се обновява (re-vendor)

```sh
npm pack openpgp@6.3.1
tar -xzf openpgp-6.3.1.tgz
# взима се dist/openpgp.min.js и се маха последният ред:
#   //# sourceMappingURL=openpgp.min.js.map
```

```powershell
Get-FileHash ui\vendor\openpgp.min.js -Algorithm SHA256   # трябва да съвпада с таблицата
```

След това: `node --check ui\vendor\openpgp.min.js`, вдигни номера в таблицата по-горе и
пробвай наново панела (генериране → шифроване → разшифроване, ключарница по отпечатък).

При смяна на версията се проверява и дали `/ui/*` CSP (`server.js`, `UI_FILES`) още
покрива нуждите: `script-src 'self'` е достатъчно, докато bundle-ът остава чист JS.

### Лицензни задължения (LGPL-3.0)

Файлът се доставя **непроменен** (само премахнат `sourceMappingURL` коментар), с
запазен лицензен банер. Пълният изходен код на библиотеката е публично достъпен на
същия номер версия (`https://registry.npmjs.org/openpgp/-/openpgp-6.3.1.tgz`, вкл.
неминифицирания `dist/openpgp.js`), така че всеки може да я подмени с друга съвместима
сборка — bundle-ът не е обвързан с останалия код на add-on-а и се зарежда с един
`<script>` таг.
