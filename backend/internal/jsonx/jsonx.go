// Package jsonx provides the ordered, comment-tolerant JSON handling the panel
// needs to rewrite sing-box configs without scrambling key order.
//
// It mirrors the Python backend exactly:
//   - strip_json5 removes // and /* */ comments plus trailing commas outside
//     strings (sing-box accepts that JSON5 subset; full JSON5 is rejected).
//   - Objects parse into *OrderMap so dumps keep the user's key order.
//   - Dump writes UTF-8 raw (ensure_ascii=False), indent 2, trailing newline.
package jsonx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"
)

// OrderMap is a JSON object that remembers insertion order.
type OrderMap struct {
	keys   []string
	values map[string]Value
}

// NewOrderMap returns an empty ordered object.
func NewOrderMap() *OrderMap {
	return &OrderMap{values: map[string]Value{}}
}

// Get returns the value for key.
func (m *OrderMap) Get(key string) (Value, bool) {
	v, ok := m.values[key]
	return v, ok
}

// Set inserts or replaces a key, keeping the original position on replace.
func (m *OrderMap) Set(key string, value Value) {
	if _, ok := m.values[key]; !ok {
		m.keys = append(m.keys, key)
	}
	m.values[key] = value
}

// Delete removes a key.
func (m *OrderMap) Delete(key string) {
	if _, ok := m.values[key]; !ok {
		return
	}
	delete(m.values, key)
	for i, k := range m.keys {
		if k == key {
			m.keys = append(m.keys[:i], m.keys[i+1:]...)
			break
		}
	}
}

// Keys returns the keys in insertion order.
func (m *OrderMap) Keys() []string {
	return append([]string(nil), m.keys...)
}

// MarshalJSON implements json.Marshaler with insertion-order keys, so API
// bodies built from OrderMap serialize correctly through encoding/json.
func (m *OrderMap) MarshalJSON() ([]byte, error) {
	return []byte(MarshalCompact(m)), nil
}

// Len returns the number of keys.
func (m *OrderMap) Len() int { return len(m.keys) }

// Clone returns a shallow copy (nested values are shared).
func (m *OrderMap) Clone() *OrderMap {
	out := NewOrderMap()
	for _, k := range m.keys {
		out.Set(k, m.values[k])
	}
	return out
}

// Value is any JSON value: nil, bool, json.Number, string, []Value or *OrderMap.
type Value = any

// StripJSON5 removes // and /* */ comments and trailing commas outside
// strings, mirroring the Python strip_json5 byte for byte.
func StripJSON5(text string) string {
	var withoutComments strings.Builder
	inString := false
	escaped := false
	index := 0
	for index < len(text) {
		char := text[index]
		if inString {
			withoutComments.WriteByte(char)
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				inString = false
			}
			index++
			continue
		}
		if char == '"' {
			inString = true
			withoutComments.WriteByte(char)
			index++
			continue
		}
		if char == '/' && index+1 < len(text) && text[index+1] == '/' {
			index += 2
			for index < len(text) && text[index] != '\r' && text[index] != '\n' {
				index++
			}
			continue
		}
		if char == '/' && index+1 < len(text) && text[index+1] == '*' {
			index += 2
			for index+1 < len(text) && !(text[index] == '*' && text[index+1] == '/') {
				index++
			}
			index += 2
			continue
		}
		withoutComments.WriteByte(char)
		index++
	}

	stripped := withoutComments.String()
	var normalized strings.Builder
	inString = false
	escaped = false
	index = 0
	for index < len(stripped) {
		char := stripped[index]
		if inString {
			normalized.WriteByte(char)
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				inString = false
			}
			index++
			continue
		}
		if char == '"' {
			inString = true
			normalized.WriteByte(char)
			index++
			continue
		}
		if char == ',' {
			next := index + 1
			for next < len(stripped) && (stripped[next] == ' ' || stripped[next] == '\t' || stripped[next] == '\r' || stripped[next] == '\n') {
				next++
			}
			if next < len(stripped) && (stripped[next] == '}' || stripped[next] == ']') {
				index++
				continue
			}
		}
		normalized.WriteByte(char)
		index++
	}
	return normalized.String()
}

// Parse parses JSON (or the sing-box JSON5 subset) into ordered values.
func Parse(text string) (Value, error) {
	dec := json.NewDecoder(strings.NewReader(StripJSON5(text)))
	dec.UseNumber()
	value, err := decodeValue(dec)
	if err != nil {
		return nil, err
	}
	// Reject trailing garbage the way json.loads does.
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("extra data after JSON value")
		}
		return nil, err
	}
	return value, nil
}

func decodeValue(dec *json.Decoder) (Value, error) {
	token, err := dec.Token()
	if err != nil {
		return nil, err
	}
	return decodeFromToken(dec, token)
}

func decodeFromToken(dec *json.Decoder, token json.Token) (Value, error) {
	switch t := token.(type) {
	case json.Delim:
		switch t {
		case '{':
			obj := NewOrderMap()
			for dec.More() {
				keyToken, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, errors.New("invalid object key")
				}
				value, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				obj.Set(key, value)
			}
			if _, err := dec.Token(); err != nil { // closing }
				return nil, err
			}
			return obj, nil
		case '[':
			arr := []Value{}
			for dec.More() {
				value, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, value)
			}
			if _, err := dec.Token(); err != nil { // closing ]
				return nil, err
			}
			return arr, nil
		default:
			return nil, fmt.Errorf("unexpected delimiter %v", t)
		}
	case nil, bool, json.Number, string:
		return t, nil
	default:
		return nil, fmt.Errorf("unexpected token %v", t)
	}
}

// ParseObject parses text and requires a top-level object.
func ParseObject(text string) (*OrderMap, error) {
	value, err := Parse(text)
	if err != nil {
		return nil, err
	}
	obj, ok := value.(*OrderMap)
	if !ok {
		return nil, errors.New("配置顶层必须是 JSON 对象")
	}
	return obj, nil
}

// Dump serializes a value with indent 2 and a trailing newline, leaving
// non-ASCII characters raw (ensure_ascii=False).
func Dump(value Value) string {
	var sb strings.Builder
	writeValue(&sb, value, 0)
	sb.WriteString("\n")
	return sb.String()
}

// Marshal compact serializes without trailing newline (for API bodies we use
// encoding/json elsewhere; this is for config/state JSON files).
func MarshalCompact(value Value) string {
	var sb strings.Builder
	writeValue(&sb, value, -1)
	return sb.String()
}

func writeValue(sb *strings.Builder, value Value, depth int) {
	pad := func(level int) {
		if depth >= 0 {
			for i := 0; i < level; i++ {
				sb.WriteString("  ")
			}
		}
	}
	switch v := value.(type) {
	case nil:
		sb.WriteString("null")
	case bool:
		if v {
			sb.WriteString("true")
		} else {
			sb.WriteString("false")
		}
	case json.Number:
		sb.WriteString(v.String())
	case float64:
		sb.WriteString(strconv.FormatFloat(v, 'g', -1, 64))
	case int:
		sb.WriteString(strconv.Itoa(v))
	case int64:
		sb.WriteString(strconv.FormatInt(v, 10))
	case string:
		writeString(sb, v)
	case []Value:
		if len(v) == 0 {
			sb.WriteString("[]")
			return
		}
		sb.WriteString("[")
		for i, item := range v {
			if i > 0 {
				sb.WriteString(",")
			}
			if depth >= 0 {
				sb.WriteString("\n")
				pad(depth + 1)
			}
			writeValue(sb, item, childDepth(depth))
		}
		if depth >= 0 {
			sb.WriteString("\n")
			pad(depth)
		}
		sb.WriteString("]")
	case *OrderMap:
		if v.Len() == 0 {
			sb.WriteString("{}")
			return
		}
		sb.WriteString("{")
		for i, key := range v.keys {
			if i > 0 {
				sb.WriteString(",")
			}
			if depth >= 0 {
				sb.WriteString("\n")
				pad(depth + 1)
			}
			writeString(sb, key)
			sb.WriteString(": ")
			writeValue(sb, v.values[key], childDepth(depth))
		}
		if depth >= 0 {
			sb.WriteString("\n")
			pad(depth)
		}
		sb.WriteString("}")
	default:
		// Fallback for exotic numeric types from callers.
		writeString(sb, fmt.Sprintf("%v", v))
	}
}

func childDepth(depth int) int {
	if depth < 0 {
		return depth
	}
	return depth + 1
}

const hexDigits = "0123456789abcdef"

func writeString(sb *strings.Builder, s string) {
	sb.WriteByte('"')
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		i += size
		switch r {
		case '"':
			sb.WriteString("\\\"")
		case '\\':
			sb.WriteString("\\\\")
		case '\n':
			sb.WriteString("\\n")
		case '\r':
			sb.WriteString("\\r")
		case '\t':
			sb.WriteString("\\t")
		default:
			if r < 0x20 {
				sb.WriteString("\\u")
				sb.WriteByte('0')
				sb.WriteByte('0')
				sb.WriteByte(hexDigits[(r>>4)&0xf])
				sb.WriteByte(hexDigits[r&0xf])
			} else {
				sb.WriteRune(r)
			}
		}
	}
	sb.WriteByte('"')
}
