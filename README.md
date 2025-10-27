# Order Demo (Go, без Docker)

Демо‑сервис на Go, который:
- слушает `nats-streaming` (stan) subject и принимает JSON заказа;
- валидирует, извлекает `order_uid`, сохраняет payload в PostgreSQL (JSONB);
- кэширует заказы в памяти и восстанавливает кэш из БД при старте;
- поднимает HTTP‑сервер с API `/api/orders/{id}` и простой HTML‑страницей для поиска заказа по ID.

> Данные статичны — архитектура хранит *полный JSON* в JSONB и ключ `id = order_uid`.

## Структура
```
.
├─ main.go                  # сервис (HTTP + подписка на NATS Streaming)
├─ cmd/publisher/main.go    # простой паблишер для проверки подписки
├─ model.json               # пример валидного заказа
├─ web/index.html           # минимальный интерфейс
├─ schema.sql               # SQL-скрипт БД
├─ .env.example             # образец конфигурации
├─ go.mod
```

## Требования
- Go 1.22+
- PostgreSQL 13+
- Локальный nats-streaming сервер (**stan**), не путать с просто NATS.

### Быстрый старт на Windows 11 (без Docker)
1) Установи Go: https://go.dev/dl/  
2) Установи PostgreSQL (через официальный инсталлятор). Запомни логин/пароль (по умолчанию `postgres/postgres`).  
3) Запусти **SQL Shell (psql)** или PgAdmin и выполни `schema.sql`:
```
psql -U postgres -h localhost -p 5432 -f schema.sql
```
4) Скачай и запусти **nats-streaming-server** (stan):
- Архивы: https://github.com/nats-io/nats-streaming-server/releases (выбирай `nats-streaming-server.exe`)
- Запуск в отдельном терминале:
```
nats-streaming-server.exe -cluster_id test-cluster -p 4222
```
> Замени `-cluster_id` при желании, но не забудь обновить `.env`.

5) Скопируй `.env.example` в `.env` и при необходимости поправь `PG_DSN`/порты.

6) Запуск сервера:
```
go run .
```
Открой http://localhost:8080 и попробуй найти заказ по ID из `model.json` (`order_uid`).

7) Отправить тестовый заказ в канал:
```
go run ./cmd/publisher
```
Если всё ок — на странице увидишь JSON заказа.

## API
- `GET /api/orders/{id}` → возвращает JSON заказа из кэша (404, если нет).

## Замечания по надёжности
- Подписка durable (`order-demo-durable`) + queue group: сообщения не теряются, когда сервис оффлайн.
- Валидация входящих данных: принимаем только JSON с полем `order_uid` (string).
- Upsert по `id`: повторные публикации перезапишут payload.

## Известные ограничения
- Схема хранит *любой* JSON заказа; при желании можно вынести поля в столбцы.
- nats-streaming помечен как deprecated, но он указан в задании, поэтому использован `stan.go`.
