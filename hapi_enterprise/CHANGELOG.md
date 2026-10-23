# Промени в hAPI Enterprise

Тази версия: **0.69.40**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.40

Издание за обновяване: **няма промяна в поведението**. Вдигната е само версията, за да
предложи Home Assistant (Add-on Store) и HACS ъпдейт до нея.

- Причина: версията беше вдигната в работното копие, но не беше качена — `main` в GitHub
  още носеше 0.69.39, а Supervisor строи add-on-а точно от default клона. Тоест версията
  в `hapi_enterprise/config.yaml` на `main` е единственото, което Home Assistant вижда.
- Съдържание: същият код като 0.69.39 (компоненти в `routes/`), същите тестове — 211/211.
