package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"
	"github.com/jackc/pgx/v5/pgxpool"
	stan "github.com/nats-io/stan.go"
)

type App struct {
	DB    *pgxpool.Pool
	Cache map[string]map[string]any
}

func mustEnv(key, def string) string {
	v := os.Getenv(key)
	if v == "" { return def }
	return v
}

func main() {
	_ = godotenv.Load("../.env")
	_ = godotenv.Load(".env")

	pgDsn := mustEnv("PG_DSN", "postgresql://orders_user:orders_pass@localhost:5432/orders_demo")
	clusterID := mustEnv("STAN_CLUSTER_ID", "test-cluster")
	clientID := mustEnv("STAN_CLIENT_ID", "orders-service-go")
	natsURL := mustEnv("STAN_NATS_URL", "nats://127.0.0.1:4223")
	channel := mustEnv("STAN_CHANNEL", "orders")
	port := mustEnv("PORT", "8000")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, pgDsn)
	if err != nil { log.Fatal(err) }
	defer pool.Close()

	app := &App{DB: pool, Cache: map[string]map[string]any{}}

	// preload cache
	rows, err := pool.Query(ctx, "SELECT order_uid, payload FROM orders")
	if err == nil {
		for rows.Next() {
			var id string
			var payload map[string]any
			if err := rows.Scan(&id, &payload); err == nil {
				app.Cache[id] = payload
			}
		}
		rows.Close()
	}
	log.Printf("Cache warmed: %d records", len(app.Cache))

	// STAN subscription
	conn, err := stan.Connect(clusterID, clientID, stan.NatsURL(natsURL))
	if err != nil { log.Fatal(err) }
	defer conn.Close()

	_, err = conn.Subscribe(channel, func(m *stan.Msg) {
		var payload map[string]any
		if err := json.Unmarshal(m.Data, &payload); err != nil {
			log.Println("bad json:", err)
			return
		}
		id, ok := payload["order_uid"].(string)
		if !ok || id == "" {
			log.Println("no order_uid in message")
			return
		}
		// upsert
		_, err := pool.Exec(ctx, `
			INSERT INTO orders (order_uid, payload) VALUES ($1, $2)
			ON CONFLICT (order_uid) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()
		`, id, payload)
		if err != nil { log.Println("db err:", err); return }
		app.Cache[id] = payload
		log.Println("upsert", id)
	}, stan.DeliverAllAvailable(), stan.DurableName("orders-durable"))
	if err != nil { log.Fatal(err) }

	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","cache":%d}`, len(app.Cache))
	})
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../web/index.html")
	})
	r.Get("/order/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if v, ok := app.Cache[id]; ok {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(v); return
		}
		var payload map[string]any
		err := pool.QueryRow(ctx, "SELECT payload FROM orders WHERE order_uid=$1", id).Scan(&payload)
		if err != nil { http.Error(w, "not found", 404); return }
		app.Cache[id] = payload
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(payload)
	})

	addr := ":" + port
	log.Println("HTTP on", addr)
	httpSrv := &http.Server{Addr: addr, Handler: r, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(httpSrv.ListenAndServe())
}
