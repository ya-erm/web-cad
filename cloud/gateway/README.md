# WebCAD API Gateway

Публичный шлюз `webcad-api` перед приватной Cloud Function `webcad-api`.
Публикует `GET /health`, вход через Яндекс (`/auth/yandex/start`,
`/auth/yandex/callback`), `GET /auth/session`, `POST /auth/logout` и OPTIONS.
`/ready` и `/documents` отсутствуют.

## Размещение

| Ресурс | ID / параметры |
| --- | --- |
| Каталог `web-cad` | `b1gej4nlbqfik932flcc` |
| API Gateway `webcad-api` | `d5dplashh93r4fam29o5` |
| Аккаунт `webcad-gateway` | `ajek8kucvbdvggu6in37` |
| Приватная функция `webcad-api` | `d4ec3d7jtmn3ua7pao9e` |
| Подключённый сертификат `webcad-api-cert-imported` | `fpq1un7fmuit7m5gq5tn` |
| Таймаут шлюза | 15 секунд |
| Логи | Выключены |

Служебный адрес:
`https://d5dplashh93r4fam29o5.avjje9e3.apigw.yandexcloud.net`.
Рабочий адрес на собственном домене: `https://api.cad.ya-erm.ru`.

`webcad-gateway` имеет только `functions.functionInvoker` непосредственно на
нашей функции. Ролей на каталог и доступа к YDB/S3 ему не требуется.
Прямой анонимный вызов функции остаётся запрещён.

Спецификация — `openapi.template.json`. Перед загрузкой заменить
`__GATEWAY_SERVICE_ACCOUNT_ID__` на ID аккаунта шлюза и сохранить результат
в `temp/`. Для создания использовать `yc serverless api-gateway create`
с `--spec <файл> --execution-timeout 15s --no-logging`.
Изменение существующего шлюза выполнять командой `update`, а не созданием дубля.

## DNS и TLS

В зоне `ya-erm.ru` через существующий API REG.RU добавлены:

| Имя относительно зоны | Тип | Значение |
| --- | --- | --- |
| `api.cad` | CNAME | `d5dplashh93r4fam29o5.avjje9e3.apigw.yandexcloud.net.` |
| `_acme-challenge.api.cad` | CNAME | `fpqicn0od37tlgojujro.cm.yandexcloud.net.` |

Исходные записи сохранены утилитой REG.RU перед добавлением новых. Существующие
записи зоны и TTL не изменялись. Доступ к REG.RU хранится вне этого репозитория;
в исходниках и конфигурации шлюза его нет.

Управляемый сертификат `webcad-api-cert` (`fpqicn0od37tlgojujro`) остался
в ожидании DNS-проверки. Его CNAME восстановлен после разового выпуска
сертификата через Let’s Encrypt DNS-01 и REG.RU; временная TXT удалена.

Вместо него подключён импортированный сертификат `webcad-api-cert-imported`
(`fpq1un7fmuit7m5gq5tn`), статус ISSUED, действует до 16 февраля 2027,
21:38 UTC. Сертификат и приватный ключ загружены в Certificate Manager.
Данные Certbot и локальная копия ключа находятся вне репозитория
в `/root/.config/webcad-cloud/acme/`.

**Автоматическое продление пока не настроено.** Импортированный сертификат
не продлевается облаком. Варианты: перейти на управляемый сертификат после
устранения проблемы проверки либо запускать ACME и обновление сертификата
через GitHub Actions. Работа API не зависит от доступности ВМ.

На собственном домене HTTPS проверяется без отключения проверки сертификата.
Проверяются сессия, CORS, CSRF, перенаправление в Яндекс, отмена и запрет
повторного callback; `/ready` и `/documents` возвращают 404.
