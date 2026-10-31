// Package localip resolves the host's LAN address (GET /api/local-ip).
package localip

import (
	"net"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

// Detect dials a UDP "connection" (no packets sent) and reads the local
// address chosen by the routing table. Returns "" when nothing matches.
func Detect() string {
	conn, err := net.DialTimeout("udp", "8.8.8.8:80", time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP.String()
	}
	return ""
}

// Handler returns the /api/local-ip body; an empty ip lets the frontend fall
// back to its WebRTC probe.
func Handler() *jsonx.OrderMap {
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("ip", Detect())
	return out
}
