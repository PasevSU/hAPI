# hAPI-DEV AI Development Director

**Роля:** главен AI координатор за развитието на цялото семейство hAPI, а не диагностичен подмодул. **Статус:** работеща класификация, автоматичен backlog, read-only административен интерфейс и CI инвентаризация. OpenAI Agents SDK runtime **все още не е активиран в production**.

## Йерархия (три нива)

```text
hAPI-DEV Development Director [главен координатор]
│
├─ Strategy Lead [Архитектура и развитие]
│  ├─ Architecture Agent — версии, определения, конфигурация, API договори
│  ├─ Frontend Agent — интерфейс, управление, достъпност
│  ├─ Locale Agent — BG/EN/DE, BCP47, ICU, езикови стандарти
│  └─ Knowledge Agent — исторически дефекти, промени, документация
│
├─ Reliability Lead [Безопасност и качество]
│  ├─ Incident Agent — откриване, повторение, регресионни сценарии
│  ├─ Security Agent — OpenPGP, права, токени, карантина
│  ├─ Storage Agent — SQLite, документи, WORM, резервни копия
│  ├─ Portal Agent — портали, папки, QR и външен достъп
│  ├─ QA Agent — две независими проверки, стари/нови функции
│  └─ Recovery Agent — възстановяване и rollback доказателства
│
└─ Delivery Lead [Оптимизация и релийзи]
   ├─ Performance Agent — измерено кеширане, латентност, ресурси
   └─ Release Agent — отделни release канали, CI, подписани артефакти
```

**Авторитет:** главният AI директор планира и възлага работата. Специалистите нямат директни права за GitHub push, HA рестарт, смяна на права, промяна на доказателства, release или production deployment. Тези операции принадлежат на независимия, защитен Release/Recovery Controller с проверени разрешения.

## Категоризация и автоматично портфолио

**Единствен източник на истина:** `ai/development-hierarchy.json` — 12 категории, 3 направления, 16 роли, договор за статуса на задачите и граници на самостоятелността.

**Работещи реализации:**
- `ai/director.js`: стабилна детерминистична класификация по файл и текст на задача; назначава категория, направление, агент, риск и ред на проверки. Това е основният защитен механизъм, който AI моделът няма право да променя със собствено предложение.
- `ai/workload.js`: създава backlog от незатворените исторически DEF записи, watch contracts и непроверените кандидати за кеш. Исторически дефект не се обявява за текущ без проверка в актуалната версия.
- `ai/inventory-cli.js`: класифицира Git промени при push/PR. `.github/workflows/ai-director-inventory.yml` стартира тестовете, генерира отчет и го прилага към GitHub Actions като артефакт — без GitHub write token, без AI разход и без автоматични промени.
- `ai/sdk-manager.js`: адаптер за OpenAI Agents SDK с главен Agent и 12 specialist tools. Може да се тества чрез мокнат SDK. Не е включен в production образ с npm пакет и няма активна външна моделна заявка. Това е следващата отделна, контролирана стъпка.
- `server.js`: защитени с OpenPGP API за йерархия, backlog и генериране на план; `/api/director/analyze` остава блокиран, докато няма проверен SDK worker, изрично AI разрешение, хранилище за тайни и бюджет.
- Административен Ingress: визуализира направленията, категориите, броя наследени задачи и формуляр за структурирано планиране.

## Жизнен цикъл на задачите

`new → categorized → evidence-collection → planned → reproduced → candidate-ready → variant-a-tested → variant-b-tested → review-ready → approved → staged → released → verified`

При неуспех: `rolled-back` / `blocked`. Невалидни преходи се отказват. Преходът към одобрение, staging, release или verified може да бъде разрешен **само** от бъдещ независим controller с необходимите криптографски и CI доказателства; AI не може да се самоодобрява.

## Реалната автоматизация в тази версия

1. GitHub промяна → автоматично категоризиране на засегнати модули.
2. Исторически протоколи → предложения за задачи с конкретен собственик, област и рисков профил.
3. Администраторска задача → готов детерминистичен план с фази за проверка.
4. Сценарии за агенти → подготвена структура за `@openai/agents` и `Agent.asTool`.

**Все още не е активирано:** автоматично генериране на patch чрез AI модел, sandbox тестове на patch, GitHub PR писане чрез agent, публикуване, автоматично обновяване на HA и rollback. Не представяйте препоръка на модел като вече изпълнено действие.

## Път към автономен Development Director

1. P0 — тестван и фиксиран `@openai/agents` + Zod v4, lockfile, отделен worker, opt-in и лимит на разходите; OpenPGP gate и tracing disabled по подразбиране.
2. P1 — реални Home Assistant diagnostic entities и непрекъснат локален monitor, независим от AI API.
3. P2 — агентен анализ на incident с валидирано търсене в историческите протоколи и четене на CI/GitHub API.
4. P3 — изолирани candidate patches, baseline-vs-patched тестове, независими A/B доказателства и Security/QA review.
5. P4 — draft PR чрез отделна GitHub App с ограничени права, само при коректни CI/artifact evidence.
6. P5 — release/rollback control, независим от целевата инсталация, с OpenPGP подписан intent и проверен recovery drill.
7. P6 — само безопасни, предварително разрешени и обратими дребни операции без човешка намеса; всички high-risk deployments изискват отделна защита.

Задължително: Enterprise и hAPI-DEV запазват различни конфигурации, версии, GHCR образи и release тагове.

## Тестове

```bash
node --test hapi_admin_devtools/tests/ai-*.test.cjs
node hapi_admin_devtools/ai/inventory-cli.js
node --test hapi_admin_devtools/tests/*.test.cjs
```

Резултатите от GitHub Actions са доказателство само за изпълнените CI проверки, не за реален HAOS deployment или безопасност на автоматичен release.
