# WebCAD Cloud API

Серверный пакет для Yandex Cloud Functions. Вход через Яндекс, сессии и выход
подключены к интерфейсу. Локальные документы можно явно загружать в облачную библиотеку; детали — [storage](../storage/README.md).

Публичный адрес: `https://api.cad.ya-erm.ru`. Функция приватная; запросы
принимает API Gateway. Подробности входа — [AUTH.md](AUTH.md).

## Поведение

- `GET /health`: работа обработчика, без обращения к облачным ресурсам.
- `GET /ready`: `SELECT 1` в YDB и ListObjectsV2 (максимум один объект) в S3.
  Ответ содержит только состояние сервисов, без содержимого документов и ошибок SDK.
- `GET /auth/yandex/start`, `GET /auth/yandex/callback`: вход через Яндекс.
- `GET /auth/session`: профиль или `user: null`; `POST /auth/logout`: отзыв сессии.
- `OPTIONS` для маршрутов авторизации: credentialed CORS только для приложения.
- Другие пути возвращают 404, другие методы на известных путях — 405.
- Проверка готовности пишет однострочный структурированный лог уровня INFO
  (WARN при ошибке): состояния YDB/S3 и длительность, без токенов,
  содержимого запросов, имён объектов и исходных ошибок SDK.
- Проверки подключений ограничены пятью секундами, ошибки возвращают 503.
  Проверка YDB не доказывает наличие прав на таблицы или успешную запись данных;
  проверка S3 не доказывает успешную загрузку файла.

Функция должна оставаться **приватной**, без `allUsers` и без
`allAuthenticatedUsers`. Вызовы разрешает YC IAM. Это инфраструктурная
авторизация, а не вход пользователей WebCAD. До добавления проверки сессий
пользователей нельзя открывать `/ready` через публичный API Gateway.

Сервисный аккаунт функции — `webcad-api`. Обработчик получает его временный
IAM-токен из `context.token.access_token` на каждом вызове. Постоянных ключей нет в исходниках и архиве. OAuth и ключ подписи S3
передаются через интеграцию с Lockbox в переменные окружения версии. SDK получает
новый драйвер на проверку и освобождает сессии и соединения после неё.

## Конфигурация

| Переменная | Формат |
| --- | --- |
| `YDB_CONNECTION_STRING` | `grpcs://ydb.serverless.yandexcloud.net:2135/ru-central1/<cloud-id>/<database-id>` |
| `S3_BUCKET` | `webcad-documents` |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | Интеграция с Lockbox для подписи S3 |
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | Интеграция с Lockbox, без значений в исходниках |

Строка подключения SDK содержит путь БД непосредственно после хоста,
а не в параметре `?database=`, который выводит YC CLI.

Права `webcad-api`:

- на `webcad-db`: IAM `ydb.auditor` для обнаружения узлов и подключения SDK;
  ACL корня БД для `<service-account-id>@as`: `ydb.database.connect`,
  `ydb.generic.read`, `ydb.granular.update_row`, `ydb.granular.erase_row`;
- на `webcad-documents`: IAM `storage.uploader` и политика бакета,
  разрешающая только `s3:GetObject`, `s3:PutObject`, `s3:ListBucket`;
- ролей на весь каталог нет. Создание схемы и настройка инфраструктуры остаются
  задачами `webcad-deployer`.

## Проверки и упаковка

Используйте Node.js 22 и npm 10 или новее:

```bash
npm ci --omit=dev --ignore-scripts --prefix cloud/api
npx tsc -p cloud/api/tsconfig.json
npx vitest run cloud/api
python3 scripts/package-cloud-api.py
```

Архив `temp/webcad-api.zip` содержит обработчик, модули авторизации, проверки подключений,
package.json, lockfile и установленные зависимости. Ключи, тесты и локальные
скрипты диагностики в него не попадают. Зависимости включены в архив, поэтому
функции не нужна их установка при развёртывании.

Согласованные параметры развёртывания:
`webcad-api`, `nodejs22`, точка входа `index.handler`, память 256 МБ,
таймаут 15 с, concurrency 1, без прогретых экземпляров, приватный вызов.
Журналирование временно выключено по согласованию с пользователем
(`--no-logging`). Позже: минимум INFO, отдельная лог-группа `webcad-api-logs`
со сроком хранения 7 дней, когда Cloud Logging станет доступен.

Функция создана: `d4ec3d7jtmn3ua7pao9e`, каталог `b1gej4nlbqfik932flcc`.
Версия облачной библиотеки `d4enaadn564den3og2q1` (тег `cloud-v1`) развёрнута 19 ноября 2026, статус ACTIVE.
Проверено вызовом из облака: `/health` и `/ready` возвращают 200, обе зависимости
отвечают `ok`. Анонимный запрос к основному URL функции возвращает 403;
публичных access bindings и политик прогретых экземпляров нет.
Это проверка подключения, а не тест сохранения документов.

Для следующих версий архив нужно временно загрузить в приватный S3-бакет
и передать `--package-bucket-name` и `--package-object-name` в
`yc serverless function version create`: прямая загрузка через `--source-path`
ограничена CLI до 3,5 МБ. После успешного развёртывания временный S3-пакет
удаляется. Локальный архив остаётся в `temp/`.

После восстановления Cloud Logging сначала проверить наличие группы
`webcad-api-logs`, чтобы избежать повторного создания при неоднозначном
результате предыдущего запроса. Затем создать новую версию с
`--log-group-id <id>` и `--min-log-level info` вместо `--no-logging`.
Для проверки через
`yc serverless function invoke` передавать событие с `httpMethod: "GET"`
и `path: "/ready"`. Основной URL функции требует IAM-авторизации;
маршруты авторизации и `/cloud/*` опубликованы через API Gateway. `/ready` доступен только
через приватный вызов функции, `/documents` ещё не реализован.

Документация платформы:
[контекст Node.js](https://yandex.cloud/ru/docs/functions/lang/nodejs/context),
[IAM в S3 API](https://yandex.cloud/ru/docs/storage/s3/),
[пример YDB SDK](https://ydb.tech/docs/en/dev/example-app/example-js).

Облачные маршруты: `GET /cloud/list`, POST `/cloud/folder`, `/cloud/prepare`,
`/cloud/commit`, `/cloud/open`, `/cloud/document` и OPTIONS. Все требуют сессию
пользователя; изменения требуют Origin приложения.

POST /cloud/document поддерживает переименование и перемещение с проверкой
revision/modified. /cloud/prepare возвращает userId для связи с локальной записью;
обновление существующего документа требует expectedRevision и expectedModified.
