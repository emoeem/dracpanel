import type { PluralForms, TranslatedLanguage } from "../translations";

/**
 * Translation fragment owned by the dashboard surface.
 *
 * Keys are the English source strings (same contract as translations.ts):
 * every entry must carry all four translated languages and keep the same
 * placeholders as the key itself.
 *
 * Keys that already live in translations.ts (or another fragment) are reused
 * from the call site instead of being redefined here — a duplicate definition
 * would silently win the spread and could drift from the shared one.
 */
export const dashboardMessages = {
  /* AGGREGATE_STATUS */
  "Pending…": { "zh-Hans": "挂起中…", "zh-Hant": "掛起中…", "fa": "در حال تعلیق…", "ru": "Приостановка…" },
  "Start failed": { "zh-Hans": "启动失败", "zh-Hant": "啟動失敗", "fa": "شروع ناموفق", "ru": "Ошибка запуска" },
  "Not running": { "zh-Hans": "未运行", "zh-Hant": "未執行", "fa": "در حال اجرا نیست", "ru": "Не запущено" },

  /* EGRESS IP */
  "Egress IP probe is not configured": {
    "zh-Hans": "未配置出口 IP 探测",
    "zh-Hant": "未設定出口 IP 探測",
    "fa": "کاوش IP خروجی پیکربندی نشده",
    "ru": "Проверка внешнего IP не настроена",
  },
  "Re-check egress IP": {
    "zh-Hans": "重新检测出口 IP",
    "zh-Hant": "重新偵測出口 IP",
    "fa": "بازبینی IP خروجی",
    "ru": "Проверить внешний IP снова",
  },
  "The panel does not make outbound requests; probing starts once egress_ip_probe_url is configured.": {
    "zh-Hans": "面板不会主动联网；配置 egress_ip_probe_url 后自动探测",
    "zh-Hant": "面板不會主動連網；設定 egress_ip_probe_url 後自動探測",
    "fa": "پنل خودبه‌خود به شبکه وصل نمی‌شود؛ پس از پیکربندی egress_ip_probe_url کاوش آغاز می‌شود.",
    "ru": "Панель не выходит в сеть сама; проверка начнётся после настройки egress_ip_probe_url.",
  },
  "Probe failed": { "zh-Hans": "探测失败", "zh-Hant": "探測失敗", "fa": "کاوش ناموفق", "ru": "Проверка не удалась" },
  "Probe not configured": {
    "zh-Hans": "未配置探测",
    "zh-Hant": "未設定探測",
    "fa": "کاوش پیکربندی نشده",
    "ru": "Проверка не настроена",
  },
  "Attribution": { "zh-Hans": "归属", "zh-Hant": "歸屬", "fa": "انتساب", "ru": "Принадлежность" },

  /* SPEED CARDS */
  "Peak {value}": { "zh-Hans": "峰值 {value}", "zh-Hant": "峰值 {value}", "fa": "اوج {value}", "ru": "Пик {value}" },
  "Total {value}": { "zh-Hans": "累计 {value}", "zh-Hant": "累計 {value}", "fa": "مجموع {value}", "ru": "Всего {value}" },

  /* TOGGLE CARDS */
  "Working…": { "zh-Hans": "处理中…", "zh-Hant": "處理中…", "fa": "در حال انجام…", "ru": "Выполняется…" },
  "Changes are written to the config file and the core restarts, briefly dropping current connections; the panel rolls back automatically if validation fails.": {
    "zh-Hans": "修改会写入配置文件并重启内核，当前连接会短暂中断；校验失败时面板会自动回滚。",
    "zh-Hant": "變更會寫入設定檔並重新啟動核心，目前連線會短暫中斷；驗證失敗時面板會自動回復。",
    "fa": "تغییرات در فایل پیکربندی نوشته و هسته دوباره راه‌اندازی می‌شود؛ اتصال‌های کنونی لحظه‌ای قطع می‌شوند و در صورت ناموفق بودن اعتبارسنجی، پنل خودکار بازمی‌گردد.",
    "ru": "Изменения запишутся в файл конфигурации и ядро перезапустится — текущие соединения ненадолго прервутся; при ошибке проверки панель откатит изменения сама.",
  },
  "Enabled · port {port}": {
    "zh-Hans": "已开启 · 端口 {port}",
    "zh-Hant": "已開啟 · 埠 {port}",
    "fa": "فعال · پورت {port}",
    "ru": "Включено · порт {port}",
  },
  "eBPF data plane is taking over": {
    "zh-Hans": "eBPF 数据面接管中",
    "zh-Hant": "eBPF 資料面接管中",
    "fa": "صفحهٔ دادهٔ eBPF در حال تصاحب است",
    "ru": "Перехват на уровне eBPF",
  },
  "About to enable": {
    "zh-Hans": "准备开启",
    "zh-Hant": "準備開啟",
    "fa": "در آستانهٔ فعال‌سازی",
    "ru": "Готовится включение",
  },
  "About to disable": {
    "zh-Hans": "准备关闭",
    "zh-Hant": "準備關閉",
    "fa": "در آستانهٔ غیرفعال‌سازی",
    "ru": "Готовится отключение",
  },

  /* TUN */
  "Traffic takeover": { "zh-Hans": "流量接管", "zh-Hant": "流量接管", "fa": "تصاحب ترافیک", "ru": "Перехват трафика" },
  "Virtual NIC": { "zh-Hans": "虚拟网卡", "zh-Hant": "虛擬網卡", "fa": "کارت شبکهٔ مجازی", "ru": "Виртуальный адаптер" },
  "Enable virtual NIC": {
    "zh-Hans": "开启虚拟网卡",
    "zh-Hant": "開啟虛擬網卡",
    "fa": "فعال‌سازی کارت شبکهٔ مجازی",
    "ru": "Включить виртуальный адаптер",
  },
  "Disable virtual NIC": {
    "zh-Hans": "关闭虚拟网卡",
    "zh-Hant": "關閉虛擬網卡",
    "fa": "غیرفعال‌سازی کارت شبکهٔ مجازی",
    "ru": "Отключить виртуальный адаптер",
  },
  "Restore the saved TUN inbound to the config and restart the core.": {
    "zh-Hans": "将把之前保存的 TUN 入站恢复到配置中，并重启内核。",
    "zh-Hant": "將把先前儲存的 TUN 入站恢復到設定中，並重新啟動核心。",
    "fa": "TUN ورودی ذخیره‌شده به پیکربندی بازگردانده و هسته دوباره راه‌اندازی می‌شود.",
    "ru": "Сохранённый TUN-инбаунд вернётся в конфигурацию, ядро перезапустится.",
  },
  "Remove the TUN inbound from the config and keep it as a preset for later restore.": {
    "zh-Hans": "将从配置中移除 TUN 入站并保存为预设，方便之后恢复。",
    "zh-Hant": "將從設定中移除 TUN 入站並儲存為預設，方便之後恢復。",
    "fa": "TUN ورودی از پیکربندی حذف و به‌عنوان پیش‌تنظیم برای بازگردانی بعدی نگه داشته می‌شود.",
    "ru": "TUN-инбаунд удалится из конфигурации и сохранится как пресет для последующего восстановления.",
  },

  /* LAN */
  "No network": { "zh-Hans": "无网络", "zh-Hant": "無網路", "fa": "بدون شبکه", "ru": "Нет сети" },
  "Intranet IP": { "zh-Hans": "内网 IP", "zh-Hant": "內網 IP", "fa": "IP داخلی", "ru": "IP локальной сети" },
  "Copy intranet IP": {
    "zh-Hans": "复制内网 IP",
    "zh-Hant": "複製內網 IP",
    "fa": "رونوشت IP داخلی",
    "ru": "Скопировать IP локальной сети",
  },
  "Switch the local inbound listen address to 0.0.0.0 and restart the core; make sure the system firewall allows this port.": {
    "zh-Hans": "将把本地入站的监听地址切换为 0.0.0.0，并重启内核；请确认系统防火墙已放行该端口。",
    "zh-Hant": "將把本地入站的監聽位址切換為 0.0.0.0，並重新啟動核心；請確認系統防火牆已放行該埠。",
    "fa": "نشانی شنود ورودی محلی به 0.0.0.0 تغییر کرده و هسته دوباره راه‌اندازی می‌شود؛ مطمئن شوید فایروال سیستم این پورت را باز کرده است.",
    "ru": "Локальный адрес прослушивания сменится на 0.0.0.0, ядро перезапустится; убедитесь, что системный брандмауэр разрешает этот порт.",
  },
  "Switch the local inbound listen address back to 127.0.0.1 and restart the core.": {
    "zh-Hans": "将把本地入站的监听地址切回 127.0.0.1，并重启内核。",
    "zh-Hant": "將把本地入站的監聽位址切回 127.0.0.1，並重新啟動核心。",
    "fa": "نشانی شنود ورودی محلی به 127.0.0.1 بازگردانده و هسته دوباره راه‌اندازی می‌شود.",
    "ru": "Локальный адрес прослушивания вернётся на 127.0.0.1, ядро перезапустится.",
  },

  /* PROFILE CARD */
  "Update current profile": {
    "zh-Hans": "更新当前配置",
    "zh-Hant": "更新目前設定",
    "fa": "به‌روزرسانی پیکربندی کنونی",
    "ru": "Обновить текущий профиль",
  },
  "Open profile page": {
    "zh-Hans": "打开配置页",
    "zh-Hant": "開啟設定頁",
    "fa": "بازکردن صفحهٔ پیکربندی",
    "ru": "Открыть страницу профиля",
  },
  "used": { "zh-Hans": "已用", "zh-Hant": "已用", "fa": "استفاده‌شده", "ru": "использовано" },
  "Profile usage": { "zh-Hans": "配置用量", "zh-Hant": "設定用量", "fa": "مصرف پیکربندی", "ru": "Использование профиля" },

  /* SERVICE STATUS */
  "Check failed": { "zh-Hans": "检测失败", "zh-Hant": "偵測失敗", "fa": "بررسی ناموفق", "ru": "Проверка не удалась" },
  "Testing": { "zh-Hans": "检测中", "zh-Hant": "偵測中", "fa": "در حال بررسی", "ru": "Проверка" },
  "Testing…": { "zh-Hans": "检测中…", "zh-Hant": "偵測中…", "fa": "در حال بررسی…", "ru": "Проверка…" },
  "Not tested": { "zh-Hans": "待检测", "zh-Hant": "待偵測", "fa": "بررسی‌نشده", "ru": "Не проверено" },
  "All available": { "zh-Hans": "全部可用", "zh-Hant": "全部可用", "fa": "همه در دسترس", "ru": "Все доступны" },
  "{count} abnormal": {
    "zh-Hans": "{count} 项异常",
    "zh-Hant": "{count} 項異常",
    "fa": "{count} مورد غیرعادی",
    "ru": "Аномалий: {count}",
  },
  "Test all": { "zh-Hans": "全部检测", "zh-Hant": "全部偵測", "fa": "بررسی همه", "ru": "Проверить все" },
  "View all services": {
    "zh-Hans": "查看全部服务",
    "zh-Hant": "檢視全部服務",
    "fa": "مشاهدهٔ همهٔ سرویس‌ها",
    "ru": "Все сервисы",
  },
  "Checked via {name}": {
    "zh-Hans": "通过 {name} 检测",
    "zh-Hant": "透過 {name} 偵測",
    "fa": "بررسی از طریق {name}",
    "ru": "Проверка через {name}",
  },
  "No usable proxy outbound": {
    "zh-Hans": "没有可用的代理出口",
    "zh-Hant": "沒有可用的代理出口",
    "fa": "خروجی پروکسی قابل استفاده‌ای نیست",
    "ru": "Нет доступного прокси-выхода",
  },

  /* MEMORY */
  "Resource details": { "zh-Hans": "资源详情", "zh-Hant": "資源詳情", "fa": "جزئیات منابع", "ru": "Ресурсы" },
  "Kernel": { "zh-Hans": "内核", "zh-Hant": "內核", "fa": "هسته", "ru": "Ядро" },

  /* FEED TABLE */
  "Initiator": { "zh-Hans": "发起", "zh-Hant": "發起", "fa": "آغازگر", "ru": "Инициатор" },
  "Connection data": { "zh-Hans": "连接数据", "zh-Hant": "連線資料", "fa": "داده‌های اتصال", "ru": "Данные подключений" },

  /* POLICY GROUPS */
  "{count} timed out": {
    "zh-Hans": "{count} 超时",
    "zh-Hant": "{count} 逾時",
    "fa": "{count} مورد از زمان خارج",
    "ru": "Таймаутов: {count}",
  },
  "Open proxies page": {
    "zh-Hans": "打开代理页",
    "zh-Hant": "開啟代理頁",
    "fa": "بازکردن صفحهٔ پروکسی‌ها",
    "ru": "Открыть страницу прокси",
  },

  /* CORE MENU */
  "Version {version}": { "zh-Hans": "版本 {version}", "zh-Hant": "版本 {version}", "fa": "نسخهٔ {version}", "ru": "Версия {version}" },
  "Core operation failed": {
    "zh-Hans": "核心操作失败",
    "zh-Hant": "核心操作失敗",
    "fa": "عملیات هسته ناموفق بود",
    "ru": "Операция с ядром не удалась",
  },
  "Direct mode cannot control the core; use the panel backend.": {
    "zh-Hans": "直接模式无法控制核心；请使用面板后端",
    "zh-Hant": "直接模式無法控制核心；請使用面板後端",
    "fa": "حالت مستقیم نمی‌تواند هسته را کنترل کند؛ از بک‌اند پنل استفاده کنید.",
    "ru": "В прямом режиме ядром управлять нельзя; нужен бэкенд панели.",
  },
  /* TRAFFIC CAPTURE (TUN / eBPF) */
  "{plane} hook · {policy} · {apps}": {
    "zh-Hans": "{plane} 钩子 · {policy} · {apps} 个应用",
    "zh-Hant": "{plane} 鉤子 · {policy} · {apps} 個應用",
    "fa": "قلاب {plane} · {policy} · {apps} برنامه",
    "ru": "хук {plane} · {policy} · приложений: {apps}",
  },
  "{plane} hook · {policy}": {
    "zh-Hans": "{plane} 钩子 · {policy}",
    "zh-Hant": "{plane} 鉤子 · {policy}",
    "fa": "قلاب {plane} · {policy}",
    "ru": "хук {plane} · {policy}",
  },
  "Shared {interface}": {
    "zh-Hans": "共享网段 {interface}",
    "zh-Hant": "共享網段 {interface}",
    "fa": "شبکهٔ مشترک {interface}",
    "ru": "Общая сеть {interface}",
  },
  "Kernel eBPF": {
    "zh-Hans": "内核 eBPF",
    "zh-Hant": "核心 eBPF",
    "fa": "eBPF هسته",
    "ru": "eBPF в ядре",
  },
  "DNS hijacked": {
    "zh-Hans": "DNS 劫持",
    "zh-Hant": "DNS 劫持",
    "fa": "DNS ربوده می‌شود",
    "ru": "DNS перехватывается",
  },
  "Manage per-app rules": {
    "zh-Hans": "管理分应用规则",
    "zh-Hant": "管理分應用程式規則",
    "fa": "مدیریت قواعد هر برنامه",
    "ru": "Правила для приложений",
  },
  "The configuration could not be read, so the capture mode is unknown": {
    "zh-Hans": "配置无法读取，接管方式未知",
    "zh-Hant": "設定無法讀取，接管方式未知",
    "fa": "پیکربندی خوانده نشد؛ حالت دریافت مشخص نیست.",
    "ru": "Конфигурация не прочитана, режим перехвата неизвестен",
  },
  "Allow list": {
    "zh-Hans": "白名单",
    "zh-Hant": "白名單",
    "fa": "فهرست مجاز",
    "ru": "Белый список",
  },
  "Block list": {
    "zh-Hans": "黑名单",
    "zh-Hant": "黑名單",
    "fa": "فهرست مسدود",
    "ru": "Чёрный список",
  },
  "No app filter": {
    "zh-Hans": "不过滤应用",
    "zh-Hant": "不過濾應用程式",
    "fa": "بدون فیلتر برنامه",
    "ru": "Без фильтра приложений",
  },
  "The core is not running; the outbound mode cannot be switched.": {
    "zh-Hans": "核心未运行，无法切换出站模式",
    "zh-Hant": "核心未執行，無法切換出站模式",
    "fa": "هسته در حال اجرا نیست؛ تغییر حالت خروجی ممکن نیست.",
    "ru": "Ядро не запущено, режим выхода переключить нельзя.",
  },
} as const satisfies Record<string, Record<TranslatedLanguage, string | PluralForms>>;
