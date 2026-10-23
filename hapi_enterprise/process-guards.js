'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Последен предпазител на процеса.
//
// Защо: в кода има 182 умишлено „плаващи“ извиквания (`void audit(...)`,
// `void recordTelemetry(...)`, таймери). Днес всяко от тях има вътрешен `.catch`, но
// една пропусната точка е достатъчна: Node 22 прекратява процеса при необработено
// отхвърляне. За add-on това значи рестарт по средата на качване или на подписване.
//
// Политиката е съзнателна и различна за двата случая:
//   • unhandledRejection — САМО се записва (лог + централизиран дневник) и процесът
//     продължава. Отхвърлено обещание е провалена фонова задача, а не повредено
//     състояние: порталът трябва да остане достъпен.
//   • uncaughtException — записва се и процесът излиза с код 1. След необработено
//     изключение състоянието е неизвестно; `boot: auto` в add-on-а вдига чист процес,
//     вместо да работим върху неизвестно състояние.
// ─────────────────────────────────────────────────────────────────────────────

function install({ log, errorLog, exit = (code) => process.exit(code) } = {}) {
  let installed = false;

  const report = (kind, err) => {
    const text = err && err.stack ? String(err.stack).split('\n').slice(0, 5).join(' | ') : String(err);
    try { if (log && log.error) log.error(kind, { err: text }) } catch { /* логването не бива да хвърля */ }
    try { if (errorLog && errorLog.append) void errorLog.append('error', 'process', text) } catch { /* дневникът не бива да хвърля */ }
    return text;
  };

  const onRejection = (reason) => { report('unhandledRejection', reason) };
  const onException = (err) => { report('uncaughtException', err); exit(1) };

  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  installed = true;

  return {
    installed: () => installed,
    // За тестове и за контролирано изключване (не се ползва в продукция).
    uninstall() {
      process.removeListener('unhandledRejection', onRejection);
      process.removeListener('uncaughtException', onException);
      installed = false;
    },
    _report: report,
  };
}

module.exports = { install };
