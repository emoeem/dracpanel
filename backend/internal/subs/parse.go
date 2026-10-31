// Subscription parsers, ported line-for-line from the Python backend.
package subs

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"gopkg.in/yaml.v3"
)

// ParseSubscription returns (outbounds, skipped kinds) for base64 link lists,
// plain link lists and Clash YAML bodies.
func ParseSubscription(text string) ([]*jsonx.OrderMap, []string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	head := strings.TrimLeft(text, " \t\r\n")
	if strings.HasPrefix(head, "proxies:") || strings.Contains(head[:min(2000, len(head))], "\nproxies:") {
		return parseClashYAML(text)
	}
	decoded := ""
	if !strings.Contains(firstLine(text), "://") {
		decoded = b64decodeSafe(text)
	}
	if decoded != "" && strings.Contains(decoded, "://") {
		text = decoded
	}
	var nodes []*jsonx.OrderMap
	var skipped []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		node, kind := ParseLink(line)
		if node != nil {
			nodes = append(nodes, node)
		} else if kind != "" {
			skipped = append(skipped, kind)
		}
	}
	return nodes, skipped
}

func firstLine(text string) string {
	if index := strings.IndexByte(text, '\n'); index >= 0 {
		return text[:index]
	}
	return text
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// b64decodeSafe mirrors b64decode_safe: URL-safe alphabet tolerant, padding
// fixed, invalid input yields "".

// orStr mirrors the Python `a or b` fallback for strings.
func orStr(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func b64decodeSafe(text string) string {
	text = strings.TrimSpace(text)
	text = strings.ReplaceAll(text, "-", "+")
	text = strings.ReplaceAll(text, "_", "/")
	if pad := len(text) % 4; pad != 0 {
		text += strings.Repeat("=", 4-pad)
	}
	// Python's b64decode(validate=False) discards non-alphabet characters.
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9',
			r == '+', r == '/', r == '=':
			return r
		default:
			return -1
		}
	}, text)
	raw, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		return ""
	}
	return string(raw)
}

// ParseLink dispatches one URI; unsupported schemes return (nil, scheme).
func ParseLink(link string) (*jsonx.OrderMap, string) {
	scheme := ""
	if index := strings.Index(link, "://"); index >= 0 {
		scheme = strings.ToLower(link[:index])
	}
	switch scheme {
	case "ss":
		node, err := parseSS(link)
		return node, errString(node, err, scheme)
	case "vmess":
		node, err := parseVMess(link)
		return node, errString(node, err, scheme)
	case "vless":
		node, err := parseVLESS(link)
		return node, errString(node, err, scheme)
	case "trojan":
		node, err := parseTrojan(link)
		return node, errString(node, err, scheme)
	case "hysteria2", "hy2":
		node, err := parseHysteria2(link)
		return node, errString(node, err, scheme)
	case "tuic":
		node, err := parseTUIC(link)
		return node, errString(node, err, scheme)
	default:
		return nil, orStr(scheme, "unknown")
	}
}

func errString(node *jsonx.OrderMap, err error, scheme string) string {
	if node != nil && err == nil {
		return ""
	}
	return scheme
}

// splitTag ports _split_tag: strip and unquote the #fragment.
func splitTag(link string) (string, string) {
	if index := strings.Index(link, "#"); index >= 0 {
		body, frag := link[:index], link[index+1:]
		if unquoted, err := url.QueryUnescape(frag); err == nil {
			return body, unquoted
		}
		return body, frag
	}
	return link, ""
}

func parseQuery(qs string) map[string]string {
	out := map[string]string{}
	for _, pair := range strings.Split(qs, "&") {
		if pair == "" {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		key = queryUnescape(key)
		value = queryUnescape(value)
		// Python dict(...) keeps the LAST occurrence of repeated keys.
		out[key] = value
	}
	return out
}

func queryUnescape(text string) string {
	if unquoted, err := url.QueryUnescape(text); err == nil {
		return unquoted
	}
	// Python's unquote leaves invalid escapes as-is.
	return strings.ReplaceAll(text, "+", " ")
}

// transport ports _transport.
func transport(query map[string]string) *jsonx.OrderMap {
	net := strings.ToLower(orStr(query["type"], orStr(query["net"], "tcp")))
	switch net {
	case "ws", "websocket":
		opts := jsonx.NewOrderMap()
		opts.Set("type", "ws")
		opts.Set("path", orStr(query["path"], "/"))
		if host := orStr(query["host"], query["sni"]); host != "" {
			headers := jsonx.NewOrderMap()
			headers.Set("Host", host)
			opts.Set("headers", headers)
		}
		return opts
	case "grpc":
		opts := jsonx.NewOrderMap()
		opts.Set("type", "grpc")
		opts.Set("service_name", orStr(query["serviceName"], orStr(query["servicename"], "")))
		return opts
	case "http", "h2":
		opts := jsonx.NewOrderMap()
		opts.Set("type", "http")
		hosts := []jsonx.Value{}
		if query["host"] != "" {
			hosts = append(hosts, query["host"])
		}
		opts.Set("host", hosts)
		return opts
	default:
		return nil
	}
}

// tlsBlock ports _tls.
func tlsBlock(query map[string]string, server string, force bool) *jsonx.OrderMap {
	security := strings.ToLower(query["security"])
	if security == "" && (force || query["sni"] != "" || query["peer"] != "" ||
		query["tls"] == "1" || query["tls"] == "true" ||
		query["allowInsecure"] == "1" || query["allowInsecure"] == "true" ||
		query["insecure"] == "1" || query["insecure"] == "true") {
		security = "tls"
	}
	if security != "tls" && security != "reality" && security != "xtls" {
		return nil
	}
	tls := jsonx.NewOrderMap()
	tls.Set("enabled", true)
	tls.Set("server_name", firstNonEmpty(query["sni"], query["peer"], server))
	if fp := firstNonEmpty(query["fp"], query["fingerprint"]); fp != "" {
		utls := jsonx.NewOrderMap()
		utls.Set("enabled", true)
		utls.Set("fingerprint", fp)
		tls.Set("utls", utls)
	}
	if query["alpn"] != "" {
		alpn := []jsonx.Value{}
		for _, item := range strings.Split(query["alpn"], ",") {
			if item != "" {
				alpn = append(alpn, item)
			}
		}
		tls.Set("alpn", alpn)
	}
	if query["allowInsecure"] == "1" || query["allowInsecure"] == "true" ||
		query["insecure"] == "1" || query["insecure"] == "true" {
		tls.Set("insecure", true)
	}
	if security == "reality" {
		reality := jsonx.NewOrderMap()
		reality.Set("enabled", true)
		reality.Set("public_key", orStr(query["pbk"], ""))
		reality.Set("short_id", orStr(query["sid"], ""))
		tls.Set("reality", reality)
	}
	return tls
}

// urlNode ports _url_node: userinfo, host, port, tag, query.
func urlNode(link, scheme string) (string, string, int, string, map[string]string, error) {
	body, tag := splitTag(link)
	rest := body[len(scheme)+3:]
	query := map[string]string{}
	if index := strings.Index(rest, "?"); index >= 0 {
		query = parseQuery(rest[index+1:])
		rest = rest[:index]
	}
	var userinfo string
	if index := strings.LastIndex(rest, "@"); index >= 0 {
		userinfo = rest[:index]
		rest = rest[index+1:]
	}
	// rpartition: split at the LAST colon (IPv6 bare hosts have no port).
	host, portStr := "", ""
	if index := strings.LastIndex(rest, ":"); index >= 0 {
		after := rest[index+1:]
		if !strings.Contains(after, ":") || strings.Contains(rest, "]") {
			host, portStr = rest[:index], after
		} else {
			host = rest
		}
	} else {
		host = rest
	}
	host = strings.Trim(host, "[]")
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return "", "", 0, "", nil, fmt.Errorf("bad port")
	}
	if unquoted, err := url.QueryUnescape(userinfo); err == nil {
		userinfo = unquoted
	}
	return userinfo, host, port, tag, query, nil
}

func parseSS(link string) (*jsonx.OrderMap, error) {
	body, tag := splitTag(link)
	rest := body[len("ss://"):]
	query := map[string]string{}
	if index := strings.Index(rest, "?"); index >= 0 {
		query = parseQuery(rest[index+1:])
		rest = rest[:index]
	}
	var creds, hostport string
	if strings.Contains(rest, "@") {
		index := strings.LastIndex(rest, "@")
		userinfo := rest[:index]
		hostport = rest[index+1:]
		creds = b64decodeSafe(userinfo)
		if creds == "" {
			if unquoted, err := url.QueryUnescape(userinfo); err == nil {
				creds = unquoted
			} else {
				creds = userinfo
			}
		}
	} else {
		decoded := b64decodeSafe(rest)
		if !strings.Contains(decoded, "@") {
			return nil, fmt.Errorf("bad ss link")
		}
		index := strings.LastIndex(decoded, "@")
		creds, hostport = decoded[:index], decoded[index+1:]
	}
	// partition(":") keeps the first colon; password may contain colons.
	methodIndex := strings.Index(creds, ":")
	method, password := creds, ""
	if methodIndex >= 0 {
		method, password = creds[:methodIndex], creds[methodIndex+1:]
	}
	hostIndex := strings.LastIndex(hostport, ":")
	if hostIndex < 0 {
		return nil, fmt.Errorf("bad ss host")
	}
	host, portStr := hostport[:hostIndex], hostport[hostIndex+1:]
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return nil, err
	}
	node := jsonx.NewOrderMap()
	node.Set("type", "shadowsocks")
	node.Set("tag", orStr(tag, fmt.Sprintf("%s:%d", strings.Trim(host, "[]"), port)))
	node.Set("server", strings.Trim(host, "[]"))
	node.Set("server_port", port)
	node.Set("method", method)
	node.Set("password", password)
	if plugin, ok := query["plugin"]; ok && plugin != "" {
		name, opts, _ := strings.Cut(plugin, ";")
		node.Set("plugin", name)
		if opts != "" {
			node.Set("plugin_opts", opts)
		}
	}
	return node, nil
}

func parseVMess(link string) (*jsonx.OrderMap, error) {
	raw := link[len("vmess://"):]
	payload := raw
	if index := strings.Index(payload, "#"); index >= 0 {
		payload = payload[:index]
	}
	data := jsonx.NewOrderMap()
	if decoded := b64decodeSafe(payload); decoded != "" {
		if value, err := jsonx.Parse(decoded); err == nil {
			if obj, ok := value.(*jsonx.OrderMap); ok {
				data = obj
			}
		}
	}
	if data.Len() == 0 {
		return nil, fmt.Errorf("bad vmess")
	}
	ps, _ := data.Get("ps")
	add, _ := data.Get("add")
	port := toInt(getOr(data, "port", float64(443)))
	node := jsonx.NewOrderMap()
	node.Set("type", "vmess")
	node.Set("tag", orStr(strValue(ps), fmt.Sprintf("%v:%d", add, port)))
	node.Set("server", strValue(add))
	node.Set("server_port", port)
	node.Set("uuid", strValue(getOr(data, "id", "")))
	node.Set("security", orStr(strValue(getOr(data, "scy", "")), "auto"))
	node.Set("alter_id", toInt(getOr(data, "aid", float64(0))))
	tlsFlag := strings.EqualFold(strValue(getOr(data, "tls", "")), "tls")
	if tlsFlag {
		tls := jsonx.NewOrderMap()
		tls.Set("enabled", true)
		tls.Set("server_name", firstNonEmpty(strValue(getOr(data, "sni", "")), strValue(getOr(data, "host", "")), strValue(add)))
		node.Set("tls", tls)
	}
	net := strings.ToLower(orStr(strValue(getOr(data, "net", "")), "tcp"))
	switch net {
	case "ws":
		transport := jsonx.NewOrderMap()
		transport.Set("type", "ws")
		transport.Set("path", orStr(strValue(getOr(data, "path", "")), "/"))
		if host := strValue(getOr(data, "host", "")); host != "" {
			headers := jsonx.NewOrderMap()
			headers.Set("Host", host)
			transport.Set("headers", headers)
		}
		node.Set("transport", transport)
	case "grpc":
		transport := jsonx.NewOrderMap()
		transport.Set("type", "grpc")
		transport.Set("service_name", orStr(strValue(getOr(data, "path", "")), ""))
		node.Set("transport", transport)
	}
	return node, nil
}

func strValue(value jsonx.Value) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		return fmt.Sprintf("%v", v)
	}
}

func parseVLESS(link string) (*jsonx.OrderMap, error) {
	uuid, host, port, tag, query, err := urlNode(link, "vless")
	if err != nil {
		return nil, err
	}
	node := jsonx.NewOrderMap()
	node.Set("type", "vless")
	node.Set("tag", orStr(tag, fmt.Sprintf("%s:%d", host, port)))
	node.Set("server", host)
	node.Set("server_port", port)
	node.Set("uuid", uuid)
	if query["flow"] != "" {
		node.Set("flow", query["flow"])
	}
	if query["encryption"] != "" && query["encryption"] != "none" {
		node.Set("encryption", query["encryption"])
	}
	if tls := tlsBlock(query, host, false); tls != nil {
		node.Set("tls", tls)
	}
	if tr := transport(query); tr != nil {
		node.Set("transport", tr)
	}
	return node, nil
}

func parseTrojan(link string) (*jsonx.OrderMap, error) {
	password, host, port, tag, query, err := urlNode(link, "trojan")
	if err != nil {
		return nil, err
	}
	node := jsonx.NewOrderMap()
	node.Set("type", "trojan")
	node.Set("tag", orStr(tag, fmt.Sprintf("%s:%d", host, port)))
	node.Set("server", host)
	node.Set("server_port", port)
	node.Set("password", password)
	tls := tlsBlock(query, host, true)
	if tls == nil {
		tls = jsonx.NewOrderMap()
		tls.Set("enabled", true)
		tls.Set("server_name", host)
	}
	node.Set("tls", tls)
	if tr := transport(query); tr != nil {
		node.Set("transport", tr)
	}
	return node, nil
}

func parseHysteria2(link string) (*jsonx.OrderMap, error) {
	scheme := "hysteria2"
	if strings.HasPrefix(link, "hy2://") {
		scheme = "hy2"
	}
	password, host, port, tag, query, err := urlNode(link, scheme)
	if err != nil {
		return nil, err
	}
	node := jsonx.NewOrderMap()
	node.Set("type", "hysteria2")
	node.Set("tag", orStr(tag, fmt.Sprintf("%s:%d", host, port)))
	node.Set("server", host)
	node.Set("server_port", port)
	node.Set("password", orStr(password, query["password"]))
	tls := jsonx.NewOrderMap()
	tls.Set("enabled", true)
	tls.Set("server_name", orStr(query["sni"], host))
	if query["insecure"] == "1" || query["insecure"] == "true" {
		tls.Set("insecure", true)
	}
	node.Set("tls", tls)
	if query["obfs"] != "" {
		obfs := jsonx.NewOrderMap()
		obfs.Set("type", query["obfs"])
		obfs.Set("password", query["obfs-password"])
		node.Set("obfs", obfs)
	}
	return node, nil
}

func parseTUIC(link string) (*jsonx.OrderMap, error) {
	userinfo, host, port, tag, query, err := urlNode(link, "tuic")
	if err != nil {
		return nil, err
	}
	uuid, _, _ := strings.Cut(userinfo, ":")
	// partition keeps the FIRST colon; password is the remainder.
	password := ""
	if index := strings.Index(userinfo, ":"); index >= 0 {
		uuid, password = userinfo[:index], userinfo[index+1:]
	}
	node := jsonx.NewOrderMap()
	node.Set("type", "tuic")
	node.Set("tag", orStr(tag, fmt.Sprintf("%s:%d", host, port)))
	node.Set("server", host)
	node.Set("server_port", port)
	node.Set("uuid", uuid)
	node.Set("password", password)
	tls := jsonx.NewOrderMap()
	tls.Set("enabled", true)
	tls.Set("server_name", orStr(query["sni"], host))
	if query["alpn"] != "" {
		alpn := []jsonx.Value{}
		for _, item := range strings.Split(query["alpn"], ",") {
			if item != "" {
				alpn = append(alpn, item)
			}
		}
		tls.Set("alpn", alpn)
	}
	if query["allow_insecure"] == "1" || query["allow_insecure"] == "true" {
		tls.Set("insecure", true)
	}
	node.Set("tls", tls)
	if query["congestion_control"] != "" {
		node.Set("congestion_control", query["congestion_control"])
	}
	return node, nil
}

// clashTypeMap ports CLASH_TYPE_MAP.
var clashTypeMap = map[string]string{
	"ss":          "shadowsocks",
	"shadowsocks": "shadowsocks",
	"vmess":       "vmess",
	"vless":       "vless",
	"trojan":      "trojan",
	"hysteria2":   "hysteria2",
	"tuic":        "tuic",
}

func parseClashYAML(text string) ([]*jsonx.OrderMap, []string) {
	var nodes []*jsonx.OrderMap
	var skipped []string
	proxies := []any{}
	var data map[string]any
	if err := yaml.Unmarshal([]byte(text), &data); err == nil && data != nil {
		if raw, ok := data["proxies"]; ok {
			if list, ok := raw.([]any); ok {
				proxies = list
			}
		}
	}
	for _, item := range proxies {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		kind := strings.ToLower(strValue(entry["type"]))
		target, supported := clashTypeMap[kind]
		if !supported {
			skipped = append(skipped, orStr(kind, "unknown"))
			continue
		}
		node := clashToOutbound(target, entry)
		if node != nil {
			nodes = append(nodes, node)
		} else {
			skipped = append(skipped, kind)
		}
	}
	return nodes, skipped
}

func clashToOutbound(kind string, item map[string]any) *jsonx.OrderMap {
	host, ok := item["server"].(string)
	if !ok || host == "" {
		return nil
	}
	port, err := strconv.Atoi(fmt.Sprintf("%v", item["port"]))
	if err != nil {
		return nil
	}
	node := jsonx.NewOrderMap()
	node.Set("type", kind)
	node.Set("tag", strOrDefault(item["name"], fmt.Sprintf("%s:%d", host, port)))
	node.Set("server", host)
	node.Set("server_port", port)
	if kind == "shadowsocks" {
		node.Set("method", strOrDefault(item["cipher"], "aes-128-gcm"))
		node.Set("password", strOrDefault(item["password"], ""))
		if plugin, ok := item["plugin"]; ok && strValue(plugin) != "" {
			node.Set("plugin", strValue(plugin))
			opts := strValue(item["plugin-opts"])
			if opts == "" {
				opts = strValue(item["plugin_opts"])
			}
			node.Set("plugin_opts", opts)
		}
	} else if kind == "vmess" {
		node.Set("uuid", strOrDefault(item["uuid"], ""))
		node.Set("security", strOrDefault(item["cipher"], "auto"))
		node.Set("alter_id", toInt(item["alterId"]))
	} else if kind == "vless" {
		node.Set("uuid", strOrDefault(item["uuid"], ""))
		node.Set("flow", strOrDefault(item["flow"], ""))
	} else if kind == "trojan" {
		node.Set("password", strOrDefault(item["password"], ""))
	} else if kind == "hysteria2" {
		node.Set("password", strOrDefault(item["password"], ""))
	} else if kind == "tuic" {
		node.Set("uuid", strOrDefault(item["uuid"], ""))
		node.Set("password", strOrDefault(item["password"], ""))
		node.Set("congestion_control", strOrDefault(item["congestion-controller"], "bbr"))
	}

	tlsValue, hasTLS := item["tls"]
	if (hasTLS && truthyJSON(tlsValue)) || kind == "trojan" || kind == "hysteria2" || kind == "tuic" {
		tls := jsonx.NewOrderMap()
		tls.Set("enabled", true)
		tls.Set("server_name", firstNonEmpty(strValue(item["sni"]), strValue(item["servername"]), host))
		if strings.EqualFold(strValue(item["skip-cert-verify"]), "true") ||
			strValue(item["skip-cert-verify"]) == "1" {
			tls.Set("insecure", true)
		}
		if alpn, ok := item["alpn"]; ok && alpn != nil {
			if list, ok := alpn.([]any); ok {
				values := []jsonx.Value{}
				for _, entry := range list {
					values = append(values, strValue(entry))
				}
				tls.Set("alpn", values)
			} else if text := strValue(alpn); text != "" {
				values := []jsonx.Value{}
				for _, entry := range strings.Split(text, ",") {
					if entry != "" {
						values = append(values, entry)
					}
				}
				tls.Set("alpn", values)
			}
		}
		if fp := strValue(item["client-fingerprint"]); fp != "" {
			utls := jsonx.NewOrderMap()
			utls.Set("enabled", true)
			utls.Set("fingerprint", fp)
			tls.Set("utls", utls)
		}
		if ro, ok := item["reality-opts"].(map[string]any); ok {
			reality := jsonx.NewOrderMap()
			reality.Set("enabled", true)
			reality.Set("public_key", strOrDefault(ro["public-key"], ""))
			reality.Set("short_id", strOrDefault(ro["short-id"], ""))
			tls.Set("reality", reality)
		}
		node.Set("tls", tls)
	}

	network := strings.ToLower(strOrDefault(item["network"], "tcp"))
	if network == "ws" {
		opts, _ := item["ws-opts"].(map[string]any)
		transport := jsonx.NewOrderMap()
		transport.Set("type", "ws")
		transport.Set("path", strOrDefault(opts["path"], "/"))
		if headers, ok := opts["headers"].(map[string]any); ok && len(headers) > 0 {
			headerMap := jsonx.NewOrderMap()
			for key, value := range headers {
				headerMap.Set(key, strValue(value))
			}
			transport.Set("headers", headerMap)
		}
		node.Set("transport", transport)
	} else if network == "grpc" {
		opts, _ := item["grpc-opts"].(map[string]any)
		transport := jsonx.NewOrderMap()
		transport.Set("type", "grpc")
		transport.Set("service_name", strOrDefault(opts["grpc-service-name"], ""))
		node.Set("transport", transport)
	}
	return node
}

func truthyJSON(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v == "true" || v == "1"
	default:
		return false
	}
}

func strOrDefault(value any, fallback string) string {
	text := strValue(value)
	if text == "" || text == "<nil>" {
		return fallback
	}
	return text
}
