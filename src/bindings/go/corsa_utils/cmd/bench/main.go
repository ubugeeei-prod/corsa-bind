package main

import (
	"fmt"
	"os"
	"strconv"

	corsautils "github.com/ubugeeei-prod/corsa-bind/src/bindings/go/corsa_utils"
)

func main() {
	if len(os.Args) < 3 {
		fatalf("usage: bench <scenario> <iterations> [options-json]")
	}
	scenario := os.Args[1]
	iterations, err := strconv.Atoi(os.Args[2])
	if err != nil || iterations < 0 {
		fatalf("invalid iterations: %q", os.Args[2])
	}
	var checksum int
	switch scenario {
	case "classify_type_text":
		for range iterations {
			checksum += len(corsautils.ClassifyTypeText("Promise<string> | null"))
		}
	case "spawn_initialize":
		if len(os.Args) < 4 {
			fatalf("spawn_initialize requires options-json")
		}
		optionsJSON := os.Args[3]
		for range iterations {
			client, err := corsautils.NewApiClientFromJSON(optionsJSON)
			if err != nil {
				fatalf("spawn: %v", err)
			}
			payload, err := client.InitializeJSON()
			if err != nil {
				_ = client.Close()
				fatalf("initialize: %v", err)
			}
			checksum += len(payload)
			if err := client.Close(); err != nil {
				fatalf("close: %v", err)
			}
		}
	default:
		fatalf("unknown scenario: %s", scenario)
	}
	fmt.Println(checksum)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
