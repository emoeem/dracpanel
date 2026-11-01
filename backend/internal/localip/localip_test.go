package localip

import (
	"net"
	"testing"
)

func ipv4(text string) net.IP { return net.ParseIP(text) }

func TestPickAddressPrefersDefaultRouteInterface(t *testing.T) {
	candidates := []candidate{
		{iface: "virbr0", addr: ipv4("192.168.122.1"), private: true},
		{iface: "wlan0", addr: ipv4("192.168.31.30"), private: true},
	}
	if got := pickAddress(candidates, "wlan0"); got != "192.168.31.30" {
		t.Fatalf("got %q, want the default-route address", got)
	}
}

func TestPickAddressIgnoresLoopback(t *testing.T) {
	candidates := []candidate{
		{iface: "lo", addr: ipv4("127.0.0.1"), private: true},
	}
	if got := pickAddress(candidates, "lo"); got != "" {
		t.Fatalf("got %q, want empty (loopback must never be reported)", got)
	}
}

func TestPickAddressFallsBackToPrivate(t *testing.T) {
	candidates := []candidate{
		{iface: "eth0", addr: ipv4("203.0.113.9"), private: false},
		{iface: "eth1", addr: ipv4("10.1.2.3"), private: true},
	}
	if got := pickAddress(candidates, ""); got != "10.1.2.3" {
		t.Fatalf("got %q, want the private address", got)
	}
}

func TestPickAddressSkipsLinkLocalAndIPv6(t *testing.T) {
	candidates := []candidate{
		{iface: "eth0", addr: ipv4("169.254.10.20"), private: false},
		{iface: "eth0", addr: net.ParseIP("fd00::1"), private: true},
	}
	if got := pickAddress(candidates, "eth0"); got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}

func TestUsableIPv4(t *testing.T) {
	cases := map[string]bool{
		"192.168.1.2": true,
		"127.0.0.1":   false,
		"0.0.0.0":     false,
		"169.254.1.1": false,
		"224.0.0.1":   false,
		"::1":         false,
	}
	for text, want := range cases {
		if got := usableIPv4(ipv4(text)); got != want {
			t.Fatalf("usableIPv4(%s) = %v, want %v", text, got, want)
		}
	}
}
