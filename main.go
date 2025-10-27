package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	stan "github.com/nats-io/stan.go"
)

type OrderPayload = json.RawMessage

// Cache is a threadsafe in-memory store
type Cache struct {
	mu sync.RWMutex
	m  map[string]OrderPayload
}

func NewCache() *Cache { return &Cache{m: make(map[string]OrderPayload)} }
func (c *Cache) Get(id string) (OrderPayload, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	val, ok := c.m[id]
	return val, ok
}
func (c *Cache) Set(id string, v OrderPayload) {
	c.mu.Lock()
	c.m[id] = v
	c.mu.Unlock()
}
func (c *Cache) LoadAll(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `SELECT id, payload FROM orders`)
	if err != nil {
		return err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id string
		var payload []byte
		if err := rows.Scan(&id, &payload); err != nil {
			return err
		}
		c.Set(id, OrderPayload(payload))
		count++
	}
	log.Printf("cache restored: %d orders", count)
	return rows.Err()
}

// extractID returns order_uid if present, otherwise empty string
func extractID(payload []byte) (string, error) {
	var obj map[string]interface{}
	if err := json.Unmarshal(payload, &obj); err != nil {
		return "", fmt.Errorf("invalid json: %w", err)
	}
	if v, ok := obj["order_uid"]; ok {
		if s, ok := v.(string); ok && s != "" {
			return s, nil
		}
	}
	return "", errors.New("order_uid not found or empty")
}

// persist stores to DB (upsert) and cache
func persist(ctx context.Context, db *sql.DB, cache *Cache, id string, payload []byte) error {
	_, err := db.ExecContext(ctx, `INSERT INTO orders(id, payload) VALUES($1, $2)
	ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`, id, payload)
	if err != nil {
		return err
	}
	cache.Set(id, OrderPayload(payload))
	return nil
}

func mustGetenv(key, def string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	return v
}

func main() {
	_ = godotenv.Load()

	pgDSN := mustGetenv("PG_DSN", "postgres://postgres:postgres@localhost:5432/order_demo?sslmode=disable")
	natsURL := mustGetenv("NATS_URL", "nats://127.0.0.1:4222")
	clusterID := mustGetenv("NATS_CLUSTER_ID", "test-cluster")
	clientID := mustGetenv("NATS_CLIENT_ID", "order-demo-consumer-1")
	subject := mustGetenv("NATS_SUBJECT", "orders")
	httpAddr := mustGetenv("HTTP_ADDR", ":8080")

	db, err := sql.Open("postgres", pgDSN)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	ctx := context.Background()
	cache := NewCache()

	if err := cache.LoadAll(ctx, db); err != nil {
		log.Printf("warmup cache failed: %v", err)
	}

	// NATS Streaming subscribe
	sc, err := stan.Connect(clusterID, clientID, stan.NatsURL(natsURL))
	if err != nil {
		log.Fatalf("connect to NATS Streaming: %v", err)
	}
	defer sc.Close()

	// Durable subscription so we don't lose messages while offline
	_, err = sc.QueueSubscribe(subject, "order-demo-q", func(msg *stan.Msg) {
		// Basic validation
		id, err := extractID(msg.Data)
		if err != nil {
			log.Printf("skip message (no order_uid): %v", err)
			return
		}
		// Normalize JSON (pretty-compact) to keep consistency
		var buf bytes.Buffer
		if err := json.Compact(&buf, msg.Data); err != nil {
			log.Printf("json compact: %v", err)
			return
		}
		if err := persist(context.Background(), db, cache, id, buf.Bytes()); err != nil {
			log.Printf("persist error: %v", err)
			return
		}
		log.Printf("saved order %s", id)
	}, stan.DurableName("order-demo-durable"), stan.SetManualAckMode(), stan.AckWait(30*time.Second), stan.MaxInflight(64))
	if err != nil {
		log.Fatalf("subscribe error: %v", err)
	}

	// HTTP server (Fiber)
	app := fiber.New(fiber.Config{
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	})

	// Serve static
	app.Get("/", func(c *fiber.Ctx) error {
		c.Type("html")
		page, _ := os.ReadFile("web/index.html")
		return c.Send(page)
	})

	app.Get("/api/orders/:id", func(c *fiber.Ctx) error {
		id := c.Params("id")
		if id == "" {
			return fiber.NewError(fiber.StatusBadRequest, "missing id")
		}
		if v, ok := cache.Get(id); ok {
			c.Type("json")
			return c.Send(v)
		}
		return fiber.NewError(fiber.StatusNotFound, "not found")
	})

	// list all orders (id + optional extracted fields)
app.Get("/api/orders", func(c *fiber.Ctx) error {
	type Row struct {
		ID        string          `json:"id"`
		Payload   json.RawMessage `json:"payload"`
		CreatedAt time.Time       `json:"created_at"`
	}

	rows, err := db.Query(`SELECT id, payload, created_at FROM orders ORDER BY created_at DESC LIMIT 500`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	defer rows.Close()

	var out []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.ID, &r.Payload, &r.CreatedAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, err.Error())
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(out)
})

// static assets
app.Static("/web", "./web")

	// graceful shutdown
	go func() {
		if err := app.Listen(httpAddr); err != nil {
			log.Printf("server stopped: %v", err)
		}
	}()
	log.Printf("HTTP listening on %s", httpAddr)

	// Wait for SIGINT/SIGTERM
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("shutting down...")
	_ = app.Shutdown()
}
