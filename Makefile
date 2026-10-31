# FlClash Web Panel — frontend (React/Vite) + Go backend (sing-box-panel)
#
#   make ui            构建 Web UI 到 dist/
#   make backend       vet + test + 构建后端二进制
#   make all           ui + backend
#   make install-backend  安装后端到 /usr/local/bin/sing-box-panel（需 root）

VERSION ?= $(shell date +%Y%m%d)

.PHONY: ui backend all install-backend clean

ui:
	pnpm build

backend:
	cd backend && go vet ./...
	cd backend && go test ./...
	cd backend && go build -trimpath -ldflags "-s -w -X main.version=0.2.0-$(VERSION)" \
		-o sing-box-panel ./cmd/sing-box-panel

all: ui backend

install-backend: backend
	install -Dm755 backend/sing-box-panel /usr/local/bin/sing-box-panel
	@echo "已安装 /usr/local/bin/sing-box-panel；记得更新 systemd drop-in ExecStart 并重启 sing-box-panel"

clean:
	rm -f backend/sing-box-panel
