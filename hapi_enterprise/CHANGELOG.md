# Промени в hAPI Enterprise

Тази версия: **0.69.90**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.90

- **Форматиране на теста на HA моста.** `tests/ha-range-bridge.cjs` е минал през prettier —
  същите проверки (Range/If-Range/ETag, `Location` + `Set-Cookie`, `session.request(method, …)`,
  `async def post`), само с интервали. Поведение не се променя: тестът пази същия договор и
  минава в матрицата.
