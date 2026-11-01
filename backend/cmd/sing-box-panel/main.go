// sing-box-panel — Go port of the local management panel backend.
//
// 设计目标与 Python 版一致：把「改配置 → 校验 → 重启 → 失败回滚」这条安全管线
// 做成可点按钮的东西，并补上订阅/节点生成、eBPF 分应用策略、服务与配置管理。
package main

import (
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"

	"github.com/emoeem/dracpanel/backend/internal/bootstrap"
	"github.com/emoeem/dracpanel/backend/internal/httpapi"
	"github.com/emoeem/dracpanel/backend/internal/settings"
	"github.com/emoeem/dracpanel/backend/internal/subs"
	"github.com/emoeem/dracpanel/backend/internal/sysutil"
)

// version is overridden by -ldflags "-X main.version=...".
var version = settings.Version

func logf(format string, args ...any) {
	sysutil.Logf(format, args...)
}

func main() {
	os.Exit(run())
}

// run owns the whole lifecycle so deferred cleanup happens; os.Exit in main
// would skip it.
func run() int {
	configPath := flag.String("config", "", "面板配置文件（默认 /etc/sing-box/panel.json）")
	port := flag.Int("port", 0, "覆盖监听端口")
	listen := flag.String("listen", "", "覆盖监听地址")
	dryRun := flag.Bool("dry-run", false, "不动 systemd，配置写到 /tmp（用于本地测试）")
	printToken := flag.Bool("print-token", false, "打印访问令牌后退出")
	showVersion := flag.Bool("version", false, "打印版本后退出")
	flag.Parse()

	if *showVersion {
		fmt.Printf("sing-box-panel %s\n", version)
		return 0
	}

	s, err := settings.Load(*configPath, *dryRun)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	if *port != 0 {
		s.Data["port"] = float64(*port)
	}
	if *listen != "" {
		s.Data["listen"] = *listen
	}

	// Token init also creates the state dir, which the notify feed and the
	// history sampler write into.
	if *printToken {
		token, err := s.Token()
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			return 1
		}
		fmt.Println(token)
		return 0
	}
	if _, err := s.Token(); err != nil {
		fmt.Fprintf(os.Stderr, "token 初始化失败：%v\n", err)
		return 1
	}

	deps, cleanup := bootstrap.Build(s)
	defer cleanup()
	handler := httpapi.New(*deps)

	addr := s.ListenAddr()
	server := &http.Server{Addr: addr, Handler: handler}
	logf("sing-box panel %s 监听 http://%s/", version, addr)
	if s.TokenCreated() {
		logf("首次运行，已生成访问令牌，请执行： sudo cat %s", s.TokenFile())
	} else {
		logf("访问令牌文件：%s（sudo cat 查看）", s.TokenFile())
	}
	if s.DryRun {
		logf("dry-run 模式：不调用 systemctl，配置写到 /tmp")
	}

	scheduler := &subs.Scheduler{Subs: deps.Subs, S: s}
	scheduler.Start()

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logf("退出：%v", err)
		return 1
	}
	return 0
}
