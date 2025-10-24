package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"os"
	"time"

	"github.com/joho/godotenv"
	stan "github.com/nats-io/stan.go"
)

func getenv(k, def string) string { v := os.Getenv(k); if v == "" { return def }; return v }

func main() {
	_ = godotenv.Load("../.env")
	_ = godotenv.Load(".env")

	clusterID := getenv("STAN_CLUSTER_ID", "test-cluster")
	clientID := getenv("STAN_CLIENT_ID", "orders-pub-go")
	natsURL := getenv("STAN_NATS_URL", "nats://127.0.0.1:4223")
	channel := getenv("STAN_CHANNEL", "orders")

	// read template
	b, err := os.ReadFile("../model.json")
	if err != nil { log.Fatal(err) }
	var base map[string]any
	json.Unmarshal(b, &base)

	conn, err := stan.Connect(clusterID, clientID, stan.NatsURL(natsURL))
	if err != nil { log.Fatal(err) }
	defer conn.Close()

	rand.Seed(time.Now().UnixNano())
	for i := 1; i <= 5; i++ {
		m := map[string]any{}
		for k, v := range base { m[k] = v }
		m["order_uid"] =  fmt.Sprintf("order-%04d", i)
		m["date_created"] = time.Now().UTC().Format(time.RFC3339)
		// randomize amount
		if pay, ok := m["payment"].(map[string]any); ok { pay["amount"] = 100 + rand.Intn(1000) }
		msg, _ := json.Marshal(m)
		if err := conn.Publish(channel, msg); err != nil { log.Println("publish:", err) }
		log.Println("published", m["order_uid"])
	}
}
