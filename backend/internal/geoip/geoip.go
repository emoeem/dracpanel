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

	mu     sync.Mutex
	loaded bool
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
	if g.loaded {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.loaded {
		return
	}
	g.loaded = true
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

func isGlobal(addr netip.Addr) bool {
	if !addr.IsValid() || addr.Zone() != "" {
		return false
	}
	if addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() || addr.IsInterfaceLocalMulticast() ||
		addr.IsUnspecified() || addr.IsMulticast() {
		return false
	}
	// Python's is_global also excludes reserved/documentation ranges.
	if v4 := addr.Unmap().As4(); addr.Is4() || addr.Is4In6() {
		first := v4[0]
		if first == 192 && addr.Unmap().As4() == [4]byte{192, 0, 2, 0} {
			return false
		}
		if first == 198 && (v4[1] == 18 || v4[1] == 19) {
			return false
		}
		if first == 100 && v4[1] == 64 {
			return false
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
