// Subscription fetching, mirroring the Python fetch(): http/https only,
// optional fixed proxy, 45s timeout, Subscription-Userinfo parsing.
package subs

import (
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/settings"
)

// ParseUserinfo ports parse_userinfo: only upload/download/total/expire ints.
func ParseUserinfo(header string) map[string]int64 {
	info := map[string]int64{}
	for _, part := range strings.Split(header, ";") {
		key, value, found := strings.Cut(strings.TrimSpace(part), "=")
		key = strings.ToLower(key)
		if !found {
			continue
		}
		switch key {
		case "upload", "download", "total", "expire":
		default:
			continue
		}
		number, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil {
			continue
		}
		info[key] = number
	}
	return info
}

// httpFetch is the real Fetcher.
func (st *Subscriptions) httpFetch(target string) (bool, string, map[string]int64) {
	parsed, err := url.Parse(target)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false, "订阅 URL 只支持 http/https", map[string]int64{}
	}
	transport := &http.Transport{}
	if proxy := st.S.String("subscription_proxy"); proxy != "" {
		if proxyURL, err := url.Parse(proxy); err == nil {
			transport.Proxy = http.ProxyURL(proxyURL)
		}
	}
	client := &http.Client{Timeout: 45 * time.Second, Transport: transport}
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return false, err.Error(), map[string]int64{}
	}
	req.Header.Set("User-Agent", "sing-box-panel/"+settings.Version)
	resp, err := client.Do(req)
	if err != nil {
		return false, err.Error(), map[string]int64{}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, err.Error(), map[string]int64{}
	}
	text := strings.ToValidUTF8(string(raw), "\uFFFD")
	userinfo := ParseUserinfo(resp.Header.Get("Subscription-Userinfo"))
	return true, text, userinfo
}
