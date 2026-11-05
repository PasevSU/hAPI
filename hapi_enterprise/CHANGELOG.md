# Промени в hAPI Enterprise

Тази версия: **0.69.154**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.154

- **Store-ът вече ТЕГЛИ образа, вместо да го строи на машината.** В `config.yaml` е добавен
  `image: "ghcr.io/pasevsu/{arch}-addon-hapi_enterprise"` — `{arch}` се замества от
  Supervisor, а тагът идва от `version:`. Дотук всяко обновяване на Raspberry Pi 4 минаваше
  през `docker buildx build` (измерено 129 s за 0.69.153) и падаше, ако мрежата или
  toolchain-ът не са налице. Сега обновяването е дръпване на готов образ.
- **Проверката на образа беше счупена по два начина — поправена.** `check-addon-image.ps1`
  питаше `https://ghcr.io/<owner>/<repo>/manifests/<tag>` без `/v2/` (това е адрес на сайта,
  не на registry API-то) и приемаше само multi-arch index, макар нашият workflow да строи
  по една архитектура на job. И двете даваха `404` върху СЪЩЕСТВУВАЩ образ — тоест скриптът
  щеше да блокира включването на `image:` завинаги. Сега приема и четирите вида манифест и
  минава за всички архитектури (`OK` за amd64, aarch64, armv7).
- **Първият пуск на новия workflow падна с `repository name must be lowercase`.** GHCR
  изисква малки букви в името на хранилището, а login-ът е `PasevSU`. Owner-ът се сваля с
  `tr '[:upper:]' '[:lower:]'`. Пази се от ново правило **HA-M14** в `ha-compatibility.cjs`:
  то проверява едновременно формата на `image:` (малки букви, `ghcr.io/<owner>/{arch}-addon-<slug>`)
  и че workflow-ът строи ВСЯКА архитектура, обявена в `arch:` — защото липсваща архитектура
  значи обновяване, което пада само на нея.
