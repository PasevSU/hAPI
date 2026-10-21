# Public API Gateway — свързване на собствен домейн към работещ Home Assistant

> Ръководство за среда: **Home Assistant OS/Supervised + add-on „hAPI Enterprise“ + собствен домейн**.
> Целта е публичните портали да се отварят на `https://<ваш-поддомейн>.<домейн>/p/<slug>/`,
> **без** HA сесия, като администрацията остава само през Ingress.
> Архитектура и правила: [`docs/plan/20-unified-plan-v7.md`](../../docs/plan/20-unified-plan-v7.md),
> [`ADR-0026`](../03_ADR/ADR-0026-public-gateway-and-digital-delivery.md).

---

## 0. Какво трябва да е налично

| Компонент      | Изискване                                                                           |
| -------------- | ----------------------------------------------------------------------------------- |
| Home Assistant | работещ, достъпен в мрежата; add-on с Ingress                                       |
| Домейн         | управление на DNS записи (A / CNAME / CAA)                                          |
| TLS            | валиден сертификат за публичния поддомейн (Let's Encrypt)                           |
| Reverse proxy  | NGINX add-on, NGINX Proxy Manager, Caddy, Traefik или Cloudflare Tunnel             |
| Add-on         | вътрешен порт **8088** (не се публикува на хоста; достъпен само през reverse proxy) |

> **Проверено на инсталацията `192.168.50.4` (2026-10-20):** панелът на add-on-а е
> `https://192.168.50.4:8123/app/c838e403_portal_enterprise`. Този адрес е **HA frontend
> маршрут**: всички подсборове под `/app/...` връщат HA shell (не се проксират), а
> `/api/public/v1/...` връща `404: Not Found`, докато интеграцията не е инсталирана.
> Затова публичният API минава през вариантите по-долу (интеграция или reverse proxy).

**Правило:** публичният домейн е **различен** от домейна на Home Assistant. Така HA
бисквитки/сесии не се смесват с публичния трафик.

---

## 1. DNS

Създайте запис за поддомейн, различен от HA:

```
portal.example.com.   A       <публичен IP на HA>        TTL 300
# или при Cloudflare Tunnel:
portal.example.com.   CNAME   <tunnel-id>.cfargotunnel.com
```

Не използвайте същия hostname, на който работи Home Assistant UI.

---

## 2. Add-on конфигурация

В `hapi_enterprise/config.yaml` публичният порт и опциите вече са налични:

```yaml
ports:
  8099/tcp: null          # вътрешен API — НЕ се публикува
  8088/tcp: null          # gateway — само вътрешен, reverse proxy го обслужва
environment:
  PORT: "8099"
  PUBLIC_GATEWAY_PORT: "8088"
  PUBLIC_GATEWAY_BIND: "0.0.0.0"
options:
  public_domain: ""       # попълва се само при отделен домейн
  public_gateway: false   # true = порталът е публикуван
  public_same_origin: true # true = адресите са относителни (същият IP/порт като HA)
```

След това в **Settings → Add-ons → hAPI Enterprise → Configuration** задайте:

| Опция                | Стойност                  | Значение                                                                                                                  |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `public_same_origin` | `true`                    | адресите са относителни — API-то работи на **същия IP и порт** като HA                                                    |
| `public_gateway`     | `true`                    | маркира gateway-я като публикуван (Public Access Test минава)                                                             |
| `public_domain`      | *(празно)*                | външният домейн за порталите, напр. `pasev.asuscomm.com`; той дава и базовия адрес на **QR кодовете** (`PUBLIC_BASE_URL`) |
| `user_roles`         | `{"pasev":"admin"}`       | HA потребител → роля (admin/operator/viewer) за Ingress                                                                   |
| `group_roles`        | `{"hapi-admins":"admin"}` | HA група → роля, когато ползвате групи                                                                                    |

> При `public_same_origin: true` не е нужен отделен домейн: адресите са
> `/api/public/v1/...` и `/p/<id>/` и се отварят на адреса на Home Assistant.
> Environment еквивалентът е `PUBLIC_GATEWAY_SAME_ORIGIN=1`.

> `start.js` подава `public_domain` като `PUBLIC_BASE_URL`. Затова QR кодът и адресът
> на портала от административния панел сочат **външния домейн**, дори когато панелът
> се отваря по вътрешния адрес (`192.168.50.4:8123`). Домейн без схема се приема като
> `https://<домейн>`; невалидна стойност се игнорира и адресът пада към адреса на
> заявката. Ръчната настройка `Settings → Публичен базов адрес` (`limits.publicBaseUrl`)
> има предимство пред опцията.

> Опциите се четат от `/data/options.json`. Ако предпочитате environment променливи
> (Docker/Compose), същите стойности са `PUBLIC_DOMAIN` и `PUBLIC_GATEWAY=1`.

Рестартирайте add-on-а. В лога трябва да се появи:

```
Public API gateway listening on 0.0.0.0:8088
```

---

## 3. Reverse proxy (изберете един вариант)

### A. NGINX Home Assistant add-on (същият хост, същият порт)

Това е препоръчителният вариант, когато API-то трябва да работи на **същия IP и порт**
като Home Assistant: един `server` блок обслужва едновременно HA и публичния канал.

`/share/nginx_proxy/data/nginx.conf` (или през UI на add-on-а):

```nginx
server {
    listen 443 ssl http2;
    server_name homeassistant.example.com;   # домейнът/IP на Home Assistant

    ssl_certificate     /ssl/fullchain.pem;
    ssl_certificate_key /ssl/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    client_max_body_size 100m;

    # 1) hAPI публичен канал — същият origin, без отделен домейн/порт
    location /p/ {
        proxy_pass http://hapi_enterprise:8088;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_buffering off;            # важно за изтегляния и Range заявки
        proxy_request_buffering off;
    }
    location /api/public/ {
        proxy_pass http://hapi_enterprise:8088;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # 2) Всичко останало — Home Assistant
    location / {
        proxy_pass http://homeassistant:8123;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $remote_addr;
    }
}
```

С `public_same_origin: true` адресите в API отговорите и QR кодовете са относителни
(`/api/public/v1/...`), т.е. работят както през `http://<HA-IP>:8123`, така и през
HTTPS домейна — без промяна в конфигурацията.

### B. NGINX Proxy Manager (друг хост в LAN)

- Proxy Host: `portal.example.com` → `http://<HA-IP>:8088`
- Scheme `http`, Block Common Exploits ✔, Websockets ✔
- SSL: Let's Encrypt, Force SSL, HTTP/2

### C. Cloudflare Tunnel (без отворени портове)

```yaml
tunnel: hapi-gateway
ingress:
  - hostname: portal.example.com
    service: http://<HA-IP>:8088
  - service: http_status:404
```

> При Cloudflare задайте `X-Forwarded-For` доверен само от тунела; IP allowlist
> работи коректно само зад доверен proxy.

### D. Същият IP и порт като Home Assistant (без reverse proxy)

Ако искате API-то да е на **същия адрес като HA** (напр. `https://192.168.50.4:8123/...`),
използвайте интеграцията `custom_components/hapi_enterprise` — тя е в репото и излага
self-only публичната повърхност на порта на HA.

1. Копирайте `custom_components/hapi_enterprise` в `/config/custom_components/hapi_enterprise`.
2. В `configuration.yaml`:

```yaml
hapi_enterprise:
  backend_url: http://c838e403_portal_enterprise:8099   # реалният slug на add-on-а + PORT
```

> За инсталацията на `192.168.50.4` hostname-ът е `c838e403_portal_enterprise`
> (същият като в `/app/c838e403_portal_enterprise`), а вътрешният порт е `8099`
> (`PORT` от `environment`).

3. Рестартирайте HA (Developer tools → Restart).
4. Проверете на **същия IP и порт**:

```
https://192.168.50.4:8123/api/public/v1/portals/<slug>
https://192.168.50.4:8123/api/public/v1/files/<fileId>/access
https://192.168.50.4:8123/api/public/v1/files/<fileId>/download
```

5. Ключът се подава като `X-Portal-Key` (или `?key=`). HA сесия **не** е нужна.
6. Административните маршрути не се проксират — `/admin/...` на `:8123` остава на HA.
7. Задайте `public_same_origin: true`, за да са относителни адресите в API отговорите.

Ограничения: изложена е само read-only повърхността (`portals`, `files`); сертификатът
е този на HA (за `192.168.50.4` е self-signed → предупреждение в браузъра). За външен
достъп с валиден сертификат ползвайте вариант A, B или C.

---

## 4. Проверка (копирайте и сравнете кодовете)

> В режим „същият IP и порт“ заменете `portal.example.com` с адреса на Home Assistant
> (напр. `homeassistant.example.com` или `http://192.168.1.10:8123`).

```bash
# 1. Публичният канал отговаря
curl -i https://portal.example.com/api/public/v1/portals/<slug>

# 2. Административните маршрути са НЕДОСТЪПНИ на публичния домейн → 404
curl -i https://portal.example.com/admin/api/v2/export/rules

# 3. UI-ят на контролния център също е недостъпен → 404
curl -i https://portal.example.com/ui/index.html

# 4. Решение за конкретен файл (без ключ)
curl -s https://portal.example.com/api/public/v1/files/<fileId>/access | jq '{allowed,reason}'

# 5. Изтегляне без ключ за заключен файл → 403 с причина
curl -i https://portal.example.com/api/public/v1/files/<fileId>/download

# 6. Изтегляне с ключ → 200
curl -i -H "X-Portal-Key: hapi_..." \
  https://portal.example.com/api/public/v1/files/<fileId>/download
```

В GUI: **Публичен gateway → Public Access Test** — задайте домейна, включете
„Публикувай публичния порт“ и проверете, че за публичен файл резултатът е
`ДОСТЪП РАЗРЕШЕН`, а за заключен — `ОТКАЗ · token-active`.

---

## 5. Портали, файлове и ключове

1. **Портал**: `Settings` в GUI или `POST /admin/api/portals` (само през Ingress/админ токен).
   Публичен портал: `PATCH /admin/api/portals/{id}` с `{"visibility":"public"}`.
2. **Файл**: качете през GUI или `POST /admin/api/portals/{id}/files`
   (`X-File-Name: ime.pdf`).
3. **Политика на файла**: `PATCH /admin/api/portals/{id}/files/{fileId}/access`
   с `{"mode":"FREE"|"KEY_REQUIRED"|"DISABLED"}`.
4. **Ключ**: `POST /admin/api/portals/{id}/files/{fileId}/access-keys` връща
   `key` (`fk_…`) **само веднъж** — предайте го на получателя; той го ползва като
   `X-Portal-Key`.
5. **Индивидуални правила** (по-строги от портала): `config/rules/file_permissions.json`
   (`access`, `visibility`, `roles`, `max_downloads`).

Йерархията е `system → storage → portal → folder → file → user/role → token → session`;
по-слаба файлова политика не може да отмени порталната.

> **Къде живеят правилата в add-on-а?** В контейнера `config/rules/*` е `/config/rules`
> (собствената папка на add-on-а, видима през Samba/SSH/File editor). При първи старт
> вградените файлове от образа се копират там и не се презаписват. Друга директория се
> задава с опцията `config_dir` (`HAPI_CONFIG_DIR`). Промените се прилагат с
> `POST /admin/api/rules/reload`, а `GET /admin/api/rules` показва кой файл откъде е
> зареден и кои липсват.

---

## 6. Сигурност — задължителен минимум

- [ ] Публичният домейн е **различен** от HA домейна.
- [ ] HTTPS е задължителен; порт 8088 не е отворен директно към интернет (само proxy).
- [ ] `8099/tcp` остава `null` (вътрешен API).
- [ ] HA long-lived token **не** се използва като публичен ключ — gateway-ят връща
      `token-scheme` за `eyJ…` стойности.
- [ ] `storage.allowed_roots` = `/share`, `/media`; `/config`, `/ssl`, `/backup` са забранени.
- [ ] Rate limit и едновременни изтегляния: `config/rules/rate_limits.json`.
- [ ] Одит: `access.allowed` / `access.denied` / `gateway.download` в `audit.jsonl`;
      публичната история е отделна от административната.
- [ ] Резервно копие на `config/rules/*` и на базата преди промяна на политики.

---

## 7. Чести проблеми

| Симптом                                           | Причина                                     | Решение                                                                    |
| ------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| `502 Bad Gateway`                                 | proxy не достига `hapi_enterprise:8088`     | проверете името на контейнера/порта; `docker exec` + `curl localhost:8088` |
| `404` на `/admin/...` през домейна                | **правилно** — публичният канал е изолиран  | администрацията е през HA Ingress                                          |
| `404` на `/p/<slug>/`                             | порталът не е `active` или slug е сгрешен   | проверете статуса в GUI                                                    |
| `403 {"reason":"token-active"}`                   | файлът е `KEY_REQUIRED` без валиден ключ    | издайте ключ и го подайте в `X-Portal-Key`                                 |
| `403 {"reason":"mode-enabled"}`                   | файлът е `DISABLED`                         | сменете режима през админ API                                              |
| Public Access Test: `gateway-published`           | `public_gateway` е `false`                  | включете опцията или `PUBLIC_GATEWAY=1`                                    |
| Public Access Test: `https`                       | няма зададен домейн                         | попълнете `public_domain`                                                  |
| URL-ите показват `portal.example.com`             | домейнът не е зададен                       | `public_domain` / `PUBLIC_DOMAIN`                                          |
| URL-ите са абсолютни, а искате същия порт като HA | `public_same_origin` е изключен             | включете `public_same_origin` / `PUBLIC_GATEWAY_SAME_ORIGIN=1`             |
| `https` в Public Access Test при same-origin      | няма домейн, но режимът е относителен       | **не е грешка** — TLS се наследява от HA                                   |
| `/api/public/...` връща HTML на HA                | nginx не пренасочва пътя                    | добавете `location /api/public/` преди `location /`                        |
| `404` на `/api/public/v1/...` на `:8123`          | интеграцията липсва или HA не е рестартиран | копирайте `custom_components/hapi_enterprise` и рестартирайте              |
| `/app/<slug>/...` връща HA интерфейс              | `/app/...` е SPA маршрут, не proxy          | ползвайте интеграцията (`/api/public/...`) или reverse proxy               |
| `401` в GUI през Ingress                          | няма роля за вашия HA потребител            | задайте `user_roles` (напр. `{"pasev":"admin"}`) и рестартирайте add-on-а  |
| `502` от интеграцията към `:8123`                 | `backend_url` е грешен                      | `http://hapi_enterprise:8099` (hostname на add-on-а, вътрешен порт)        |

---

## 8. Какво още не е включено (по план)

| Способност                                              | Статус                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| Автоматично издаване на TLS през add-on-а               | извън обхват — ползва се reverse proxy                 |
| Географски ограничения                                  | само при надежден източник на геолокация               |
| Компресия / части / криптиране на експортни пакети      | `capabilities` = `false` (планирано)                   |
| Собствен домейн на портал (различен от gateway домейна) | по-късен етап (portal-level domain)                    |
| Излагане на публичния API на IP/порта на HA             | ✅ чрез `custom_components/hapi_enterprise` (read-only) |
