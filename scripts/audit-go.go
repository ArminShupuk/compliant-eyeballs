// A local-only comparator for scripts/audit-comparators.mjs.
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http/httptrace"
	"os"
	"time"
)

func main() {
	if len(os.Args) != 6 {
		panic("usage: audit-go host port dns-port mode timeout-ms")
	}
	host, port, dnsPort, mode := os.Args[1], os.Args[2], os.Args[3], os.Args[4]
	duration, err := time.ParseDuration(os.Args[5] + "ms")
	if err != nil {
		panic(err)
	}
	resolver := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "udp", "127.0.0.1:"+dnsPort)
	}}
	d := net.Dialer{Resolver: resolver, FallbackDelay: 50 * time.Millisecond}
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		ConnectStart: func(network, address string) {
			fmt.Fprintf(os.Stderr, "attempt=%s at_ms=%d\n", address, time.Since(started).Milliseconds())
		},
	})
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	if err == nil && (mode == "tls" || mode == "tls-slow") {
		client := tls.Client(conn, &tls.Config{InsecureSkipVerify: true, ServerName: host}) // loopback fixture only
		err = client.HandshakeContext(ctx)
		if err == nil {
			conn = client
		}
	}
	if err != nil {
		if conn != nil {
			conn.Close()
		}
		fmt.Printf("error=%v elapsed_ms=%d\n", err, time.Since(started).Milliseconds())
		os.Exit(2)
	}
	defer conn.Close()
	fmt.Printf("remote=%s elapsed_ms=%d\n", conn.RemoteAddr(), time.Since(started).Milliseconds())
}
