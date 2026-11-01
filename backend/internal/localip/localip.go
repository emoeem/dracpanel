// Package localip resolves the host's LAN address (GET /api/local-ip).
package localip

import (
	"net"
	"os"
	"strings"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
)

type candidate struct {
	iface   string
	addr    net.IP
	private bool
}

// Detect returns the host's LAN IPv4 address, or "" when none is found.
//
// A UDP dial alone is wrong on hosts that transparently proxy traffic: eBPF
// cgroup hooks rewrite the destination to loopback, so the source address the
// routing table reports becomes 127.0.0.1. Enumerating interfaces and
// preferring the default-route one avoids that.
func Detect() string {
	if picked := pickLocalAddress(); picked != "" {
		return picked
	}
	return dialAddress()
}

func pickLocalAddress() string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	var candidates []candidate
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch value := addr.(type) {
			case *net.IPNet:
				ip = value.IP
			case *net.IPAddr:
				ip = value.IP
			}
			if ip == nil {
				continue
			}
			candidates = append(candidates, candidate{iface: iface.Name, addr: ip, private: ip.IsPrivate()})
		}
	}
	return pickAddress(candidates, defaultRouteInterface())
}

// pickAddress prefers an address on the default-route interface, then the
// first private one. Loopback, link-local and unspecified addresses never win.
func pickAddress(candidates []candidate, defaultIface string) string {
	fallback := ""
	for _, item := range candidates {
		if !usableIPv4(item.addr) {
			continue
		}
		if defaultIface != "" && item.iface == defaultIface {
			return item.addr.String()
		}
		if item.private && fallback == "" {
			fallback = item.addr.String()
		}
	}
	return fallback
}

func usableIPv4(ip net.IP) bool {
	v4 := ip.To4()
	if v4 == nil {
		return false
	}
	if v4.IsLoopback() || v4.IsUnspecified() || v4.IsLinkLocalUnicast() || v4.IsMulticast() {
		return false
	}
	return true
}

// defaultRouteInterface reads the Linux routing table; other platforms simply
// fall through to the private-address preference.
func defaultRouteInterface() string {
	raw, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		if fields[1] == "00000000" {
			return fields[0]
		}
	}
	return ""
}

// dialAddress is the last resort: the routing table picks a source address
// without sending packets. Proxied hosts may report loopback, which is
// discarded so the frontend can fall back to its WebRTC probe.
func dialAddress() string {
	conn, err := net.DialTimeout("udp", "8.8.8.8:80", time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok && usableIPv4(addr.IP) {
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
