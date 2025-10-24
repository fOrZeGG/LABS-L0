# Demo без Docker: NATS Streaming → PostgreSQL → HTTP + кэш (Go и Node.js)

- Модель данных — `model.json` (как прислано).
- Хранение в PostgreSQL — одна таблица `orders(order_uid, payload JSONB)`.
- Кэш в памяти восстанавливается из БД на старте.
- HTTP отдаёт `/order/:order_uid` и `/` (простая форма).
- Подписка `stan` (NATS Streaming) на канал `orders` с durable и `DeliverAllAvailable`.

## Предварительно
1) Установить PostgreSQL, выполнить `db.sql` под пользователем `postgres`.
2) Скачивать `nats-streaming-server` и запустить, например:
```
nats-streaming-server -p 4223 -m 8223 -store memory -cluster_id test-cluster
```
3) Скопировать `.env.example` → `.env` и при необходимости поправить.

## Вариант A: Go
```
cd go_service
go mod tidy
go run ./cmd/server
# в другом окне
go run ./cmd/publisher
```
Сервис: http://localhost:8000

## Вариант B: Node.js
```
cd node_service
npm i
npm run dev        # сервер
# в другом окне
npm run publish    # паблишер
```
Сервис: http://localhost:8000

