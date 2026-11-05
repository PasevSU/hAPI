# Промени в hAPI Enterprise

Тази версия: **0.69.163**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.163

- **32-bit ARM отпада от `arch` — и warning-ът в лога на Supervisor изчезва.** При всяко
  зареждане на store-а Supervisor пишеше `App 'hAPI Enterprise' uses deprecated 'arch' values:
  ['armv7']`. Причината е в самия Supervisor: `ARCH_ALL = [aarch64, amd64]`, а `armv7`,
  `armhf` и `i386` са в `ARCH_DEPRECATED`; когато приложение има **само** такива, той вдига и
  repair „deprecated_arch_app“. Обещанието беше и празно — HAOS не се публикува за 32-bit
  машини, тоест никой не можеше да се възползва, а редът стигаше до всеки. Сега `arch` е
  `amd64` + `aarch64`; отпадна и job-ът `armv7` в билда на образа, и третата проверка в
  `check-addon-image.ps1`.
- **Договорът за хардуер се проверява, не се разказва.** `tests/raspberrypi-compat.cjs` вече
  изисква точно 64-битовите архитектури и **забранява** всяка deprecated стойност, а
  `HA-M04` в `tests/ha-compatibility.cjs` стана `blocker` (преди беше `info`, тоест
  забележката се виждаше, но не спираше издание). Ако някой върне `armv7`, матрицата пада.
- **Казано и в документацията:** глава 2 на ръководството обяснява защо 32-bit не се
  обещава, глава 6 добавя симптома „No update available for app hAPI Enterprise“ (остарял
  диалог след успешно обновяване — виж `version:` в Информация, не в диалога),
  `hapi_enterprise/README.md` вече не обещава 32-bit редове в таблицата с дъските, а
  `RELEASE_QUALIFICATION.md` отбелязва, че забележката е затворена.
- **Регистърът на дефектите:** нов ред `DEF-25` (Съвместимост) със затварянето и
  доказателството — за да не се върне същата стойност тихо.
