package main

import (
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	stan "github.com/nats-io/stan.go"
)

func mustGetenv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

func main() {
	_ = godotenv.Load()
	natsURL := mustGetenv("NATS_URL", "nats://127.0.0.1:4222")
	clusterID := mustGetenv("NATS_CLUSTER_ID", "test-cluster")
	subject := mustGetenv("NATS_SUBJECT", "orders")

	sc, err := stan.Connect(clusterID, "order-demo-publisher-"+time.Now().Format("150405"), stan.NatsURL(natsURL))
	if err != nil {
		log.Fatal(err)
	}
	defer sc.Close()

	b, err := os.ReadFile("model.json")
	if err != nil {
		log.Fatal(err)
	}

	// validate JSON and ensure order_uid exists
	var obj map[string]interface{}
	if err := json.Unmarshal(b, &obj); err != nil {
		log.Fatalf("model.json is not valid JSON: %v", err)
	}
	if _, ok := obj["order_uid"]; !ok {
		log.Fatal("model.json must contain 'order_uid' field")
	}

	if err := sc.Publish(subject, b); err != nil {
		log.Fatal(err)
	}
	log.Println("Published model.json to subject:", subject)
}
