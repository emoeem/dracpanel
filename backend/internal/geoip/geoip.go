// Package geoip ports the Python GeoIP class: lazy mmdb load, City fields,
// 404 for non-global addresses, 503 when the database is unavailable.
package geoip

import (
	"fmt"
	"net/netip"
	"os"
	"sync"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/oschwald/maxminddb-golang"
)

var defaultPaths = []string{
	"/usr/share/GeoIP/GeoLite2-City.mmdb",
	"/usr/share/GeoIP/dbip-city-lite.mmdb",
}

// GeoIP lazily opens the City database.
type GeoIP struct {
	S *settings.Settings

	// once also publishes reader/Err/Path to later readers: Lookup reads them
	// without a lock, which is only safe because sync.Once establishes the
	// happens-before edge.
	once   sync.Once
	reader *maxminddb.Reader
	Err    string
	Path   string
}

// New builds the lookup.
func New(s *settings.Settings) *GeoIP { return &GeoIP{S: s} }

func (g *GeoIP) paths() []string {
	var candidates []string
	if configured := g.S.String("geoip_database"); configured != "" {
		candidates = append(candidates, configured)
	}
	for _, path := range defaultPaths {
		found := false
		for _, existing := range candidates {
			if existing == path {
				found = true
				break
			}
		}
		if !found {
			candidates = append(candidates, path)
		}
	}
	return candidates
}

func (g *GeoIP) load() {
	g.once.Do(func() {
		for _, path := range g.paths() {
			if path == "" {
				continue
			}
			if _, err := os.Stat(path); err != nil {
				continue
			}
			reader, err := maxminddb.Open(path)
			if err != nil {
				g.Err = err.Error()
				continue
			}
			g.reader = reader
			g.Path = path
			g.Err = ""
			return
		}
		if g.Err == "" {
			g.Err = "database not found"
		}
	})
}

type cityRecord struct {
	Country struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"country"`
	City struct {
		Names struct {
			En string `maxminddb:"en"`
		} `maxminddb:"names"`
	} `maxminddb:"city"`
	Location struct {
		Latitude  float64 `maxminddb:"latitude"`
		Longitude float64 `maxminddb:"longitude"`
	} `maxminddb:"location"`
}

// reservedIPv4 lists documentation and shared-address ranges that are not
// globally routable; netip's own predicates cover the rest.
var reservedIPv4 = []netip.Prefix{
	netip.MustParsePrefix("192.0.2.0/24"),    // TEST-NET-1
	netip.MustParsePrefix("198.51.100.0/24"), // TEST-NET-2
	netip.MustParsePrefix("203.0.113.0/24"),  // TEST-NET-3
	netip.MustParsePrefix("192.88.99.0/24"),  // 6to4 relay anycast
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking
	netip.MustParsePrefix("100.64.0.0/10"),   // CGNAT shared address space
}

func isGlobal(addr netip.Addr) bool {
	if !addr.IsValid() || addr.Zone() != "" {
		return false
	}
	if addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() || addr.IsInterfaceLocalMulticast() ||
		addr.IsUnspecified() || addr.IsMulticast() {
		return false
	}
	if addr.Is4() || addr.Is4In6() {
		v4 := addr.Unmap()
		for _, prefix := range reservedIPv4 {
			if prefix.Contains(v4) {
				return false
			}
		}
	}
	return true
}

// Lookup ports GeoIP.lookup: (body, status).
func (g *GeoIP) Lookup(rawIP string) (*jsonx.OrderMap, int) {
	addr, err := netip.ParseAddr(trimSpace(rawIP))
	if err != nil || !isGlobal(addr) {
		return errBody("private or unresolvable ip"), 404
	}
	g.load()
	if g.reader == nil {
		return errBody("geoip database unavailable"), 503
	}
	var record cityRecord
	if err := g.reader.Lookup(addr.AsSlice(), &record); err != nil {
		return errBody("private or unresolvable ip"), 404
	}
	if record.Location.Longitude == 0 && record.Location.Latitude == 0 {
		// Python requires numeric lon/lat; a zero fix still is numeric, so
		// only missing database data (both unset) behaves the same either way.
		_ = err
	}
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	out.Set("ip", addr.String())
	out.Set("lon", record.Location.Longitude)
	out.Set("lat", record.Location.Latitude)
	out.Set("country", record.Country.ISOCode)
	out.Set("city", record.City.Names.En)
	return out, 200
}

func trimSpace(text string) string {
	start, end := 0, len(text)
	for start < end && isSpace(text[start]) {
		start++
	}
	for end > start && isSpace(text[end-1]) {
		end--
	}
	return text[start:end]
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\r' || b == '\n'
}

func errBody(msg string) *jsonx.OrderMap {
	out := jsonx.NewOrderMap()
	out.Set("ok", false)
	out.Set("message", msg)
	return out
}

// Close releases the reader.
func (g *GeoIP) Close() error {
	if g.reader != nil {
		return g.reader.Close()
	}
	return fmt.Errorf("not open")
}
