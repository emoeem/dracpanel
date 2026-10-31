// Package meminfo implements GET /api/memory: the panel process RSS ("app")
// and the sing-box core RSS ("kernel"), mirroring FlClash's split.
package meminfo

import (
	"bufio"
	"os"
	"strconv"
	"strings"

	"github.com/emoeem/dracpanel/backend/internal/jsonx"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/systemd"
)

// Controller reads process RSS.
type Controller struct {
	S       *settings.Settings
	Service *systemd.Service
}

// rssKB reads VmRSS (kB) from /proc/<pid>/status; 0 when unavailable.
func rssKB(pid string) int64 {
	file, err := os.Open("/proc/" + pid + "/status")
	if err != nil {
		return 0
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if kb, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
					return kb
				}
			}
			return 0
		}
	}
	return 0
}

// Get returns {app, kernel, total} in bytes; keys are omitted when unknown.
func (c *Controller) Get() *jsonx.OrderMap {
	out := jsonx.NewOrderMap()
	out.Set("ok", true)
	app := rssKB(strconv.Itoa(os.Getpid())) * 1024
	kernel := int64(0)
	if pid := c.Service.MainPID(); pid != "" {
		kernel = rssKB(pid) * 1024
	}
	if app > 0 {
		out.Set("app", app)
	}
	if kernel > 0 {
		out.Set("kernel", kernel)
	}
	if app+kernel > 0 {
		out.Set("total", app+kernel)
	}
	return out
}
