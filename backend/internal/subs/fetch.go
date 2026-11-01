// Subscription fetching, mirroring the Python fetch(): http/https only,
// optional fixed proxy, 45s timeout, Subscription-Userinfo parsing.
package subs

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/emoeem/dracpanel/backend/internal/settings"
)

// maxSubscriptionBytes caps how much of a subscription response we read. A
// hostile or broken server can otherwise stream unbounded data into a process
// that runs as root.
const maxSubscriptionBytes = 8 << 20 // 8 MiB

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

// blockedTarget reports whether host resolves to an address the panel must not
// fetch from. Loopback and link-local (169.254.0.0/16, fe80::/10) are refused
// so a subscription URL cannot be used to probe the host itself or the cloud
// metadata endpoint. RFC1918 space is still allowed: self-hosting a
// subscription on the LAN is a normal setup for this tool.
func blockedTarget(host string) bool {
	ips, err := net.LookupIP(host)
	if err != nil {
		// Unresolvable hosts are rejected rather than passed through: the
		// error text is returned to the caller either way.
		return true
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return true
		}
	}
	return false
}

// httpFetch is the real Fetcher.
func (st *Subscriptions) httpFetch(target string) (bool, string, map[string]int64) {
	parsed, err := url.Parse(target)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false, "订阅 URL 只支持 http/https", map[string]int64{}
	}
	host := parsed.Hostname()
	if host == "" {
		return false, "订阅 URL 缺少主机名", map[string]int64{}
	}
	if blockedTarget(host) {
		return false, "订阅 URL 指向本机或链路本地地址，已拒绝", map[string]int64{}
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
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxSubscriptionBytes+1))
	if err != nil {
		return false, err.Error(), map[string]int64{}
	}
	if len(raw) > maxSubscriptionBytes {
		return false, "订阅内容超过 8 MiB，已中止", map[string]int64{}
	}
	text := strings.ToValidUTF8(string(raw), "\uFFFD")
	userinfo := ParseUserinfo(resp.Header.Get("Subscription-Userinfo"))
	return true, text, userinfo
}
