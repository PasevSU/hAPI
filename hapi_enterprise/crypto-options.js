'use strict';
// Крипто опции на add-on-а: env (от start.js) има приоритет, после options.json, после
// подразбиране. Така същите стойности важат и при ръчен старт без Supervisor.
//
// Отделен модул, за да остане `server.js` под тавана на дължината и защото тук има
// правило, което не е „просто четене на конфигурация“: TSA адрес по открит канал.
const DEFAULTS = {
  tsaStart: 'https://zeitstempel.dfn.de/',
  // https, не http: времевият печат по открит канал се подправя от всеки по пътя —
  // TSR-ът остава валиден, но с ЧУЖДО време, тоест доказателството за „кога“ лъже.
  tsaStop: 'https://timestamp.digicert.com',
};

/** Чете крипто опциите и предупреждава за http TSA адрес (не отказва — старите конфигурации). */
function create({ optionValue, isEnabled, warn = (line) => console.warn(line) }) {
  const options = {
    tsaEnabled: isEnabled(optionValue('TSA_ENABLED', 'tsa_enabled', 'false')),
    tsaStart: optionValue('TSA_START_URL', 'tsa_start_url', DEFAULTS.tsaStart),
    tsaStop: optionValue('TSA_STOP_URL', 'tsa_stop_url', DEFAULTS.tsaStop),
    signPackages: isEnabled(optionValue('SIGN_PACKAGES', 'sign_packages', 'false')),
    signingKey: optionValue('SIGNING_KEY', 'signing_key', ''),
    encryptFiles: isEnabled(optionValue('ENCRYPT_FILES', 'encrypt_files', 'false')),
    tlsCert: optionValue('TLS_CERT', 'tls_cert', ''),
    tlsKey: optionValue('TLS_KEY', 'tls_key', ''),
  };
  // Предупреждение, не отказ: съществуващи инсталации имат http адрес и не бива да
  // спират от ъпдейт. `log` още не съществува на този етап, затова се пише в stderr —
  // като предупреждението за HA long-lived токен в start.js.
  if (options.tsaEnabled) {
    for (const [name, value] of [['tsa_start_url', options.tsaStart], ['tsa_stop_url', options.tsaStop]]) {
      if (/^http:/i.test(String(value || ''))) {
        warn('TSA_INSECURE_TRANSPORT: ' + name + ' uses http (' + value + ') — a time-stamp over plain http can be replayed or replaced in transit; use https');
      }
    }
  }
  return options;
}

module.exports = { create, DEFAULTS };
