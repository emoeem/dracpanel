import type { PluralForms, TranslatedLanguage } from "../translations";

/**
 * Translation fragment owned by the tools surface.
 *
 * Keys are the English source strings (same contract as translations.ts):
 * every entry must carry all four translated languages and keep the same
 * placeholders as the key itself.
 */
export const toolsMessages = {
  /* ── general view ── */
  "Core action failed": {
    "zh-Hans": "核心操作失败",
    "zh-Hant": "核心操作失敗",
    "fa": "عملیات هسته ناموفق بود",
    "ru": "Не удалось выполнить действие с ядром",
  },
  "Current server": {
    "zh-Hans": "当前服务器",
    "zh-Hant": "目前伺服器",
    "fa": "سرور فعلی",
    "ru": "Текущий сервер",
  },
  "Config path": {
    "zh-Hans": "配置路径",
    "zh-Hant": "設定路徑",
    "fa": "مسیر پیکربندی",
    "ru": "Путь к конфигурации",
  },
  "Core controls require the panel backend; unavailable in direct mode.": {
    "zh-Hans": "核心控制需要面板后端；直接模式下不可用。",
    "zh-Hant": "核心控制需要面板後端；直接模式下無法使用。",
    "fa": "کنترل هسته به بک‌اند پنل نیاز دارد؛ در حالت مستقیم در دسترس نیست.",
    "ru": "Управление ядром требует бэкенда панели; в прямом режиме недоступно.",
  },
  "Log toggle": {
    "zh-Hans": "日志开关",
    "zh-Hant": "日誌開關",
    "fa": "کلید گزارش",
    "ru": "Переключатель журнала",
  },
  "Shows the Logs page in the sidebar and bottom navigation.": {
    "zh-Hans": "开启后侧栏与底部导航显示「日志」页",
    "zh-Hant": "開啟後側邊欄與底部導覽顯示「日誌」頁",
    "fa": "صفحه گزارش‌ها را در نوار کناری و ناوبری پایین نشان می‌دهد.",
    "ru": "Показывает страницу журнала в боковой панели и нижней навигации.",
  },
  "Server management": {
    "zh-Hans": "服务器管理",
    "zh-Hant": "伺服器管理",
    "fa": "مدیریت سرورها",
    "ru": "Управление серверами",
  },
  "{count} servers": {
    "zh-Hans": "{count} 个服务器",
    "zh-Hant": "{count} 個伺服器",
    "fa": "{count} سرور",
    "ru": "Серверов: {count}",
  },
  "Clear credentials and return to the sign-in screen": {
    "zh-Hans": "清除凭据并返回登录界面",
    "zh-Hant": "清除憑證並返回登入畫面",
    "fa": "پاک‌کردن اعتبارنامه‌ها و بازگشت به صفحه ورود",
    "ru": "Очистить учётные данные и вернуться к входу",
  },
  "Stopping the core drops every connection that goes through it. Continue?": {
    "zh-Hans": "停止内核会中断所有经过它的连接，确定继续？",
    "zh-Hant": "停止核心會中斷所有經過它的連線，確定繼續？",
    "fa": "توقف هسته همه اتصال‌های عبوری از آن را قطع می‌کند. ادامه می‌دهید؟",
    "ru": "Остановка ядра разорвёт все соединения через него. Продолжить?",
  },

  /* ── advanced view ── */
  "Apply": {
    "zh-Hans": "应用",
    "zh-Hant": "套用",
    "fa": "اعمال",
    "ru": "Применить",
  },
  "Applying…": {
    "zh-Hans": "应用中…",
    "zh-Hant": "套用中…",
    "fa": "در حال اعمال…",
    "ru": "Применение…",
  },
  "In direct mode, the switches and configuration tools below are unavailable.": {
    "zh-Hans": "直接模式下，以下开关与配置工具不可用。",
    "zh-Hant": "直接模式下，以下開關與設定工具無法使用。",
    "fa": "در حالت مستقیم، کلیدها و ابزارهای پیکربندی زیر در دسترس نیستند.",
    "ru": "В прямом режиме переключатели и инструменты настройки ниже недоступны.",
  },
  "The panel backend must expose /api/system-proxy.": {
    "zh-Hans": "需要面板后端提供 /api/system-proxy 接口",
    "zh-Hant": "需要面板後端提供 /api/system-proxy 介面",
    "fa": "بک‌اند پنل باید /api/system-proxy را ارائه کند.",
    "ru": "Бэкенд панели должен предоставлять /api/system-proxy.",
  },
  "Port": {
    "zh-Hans": "端口",
    "zh-Hant": "連接埠",
    "fa": "پورت",
    "ru": "Порт",
  },
  "Port {port}": {
    "zh-Hans": "端口 {port}",
    "zh-Hant": "連接埠 {port}",
    "fa": "پورت {port}",
    "ru": "Порт {port}",
  },
  "Panel backend required": {
    "zh-Hans": "需要面板后端",
    "zh-Hant": "需要面板後端",
    "fa": "نیاز به بک‌اند پنل",
    "ru": "Требуется бэкенд панели",
  },
  "Traffic capture (eBPF)": {
    "zh-Hans": "流量接管（eBPF）",
    "zh-Hant": "流量接管（eBPF）",
    "fa": "تصاحب ترافیک (eBPF)",
    "ru": "Перехват трафика (eBPF)",
  },
  "Virtual adapter (TUN)": {
    "zh-Hans": "虚拟网卡（TUN）",
    "zh-Hant": "虛擬網卡（TUN）",
    "fa": "کارت شبکه مجازی (TUN)",
    "ru": "Виртуальный адаптер (TUN)",
  },
  "In eBPF mode, the kernel's ebpf inbound handles traffic.": {
    "zh-Hans": "eBPF 模式下流量由内核 ebpf 入站接管",
    "zh-Hant": "eBPF 模式下流量由核心 ebpf 入站接管",
    "fa": "در حالت eBPF، ترافیک توسط ورودی ebpf هسته مدیریت می‌شود.",
    "ru": "В режиме eBPF трафиком управляет ebpf-входящий ядра.",
  },
  "Enabled (tun inbound)": {
    "zh-Hans": "已开启（tun inbound）",
    "zh-Hant": "已開啟（tun inbound）",
    "fa": "فعال (tun inbound)",
    "ru": "Включено (tun inbound)",
  },
  "LAN proxy": {
    "zh-Hans": "局域网代理",
    "zh-Hant": "區域網路代理",
    "fa": "پروکسی LAN",
    "ru": "Прокси в локальной сети",
  },
  "Disabled (loopback only)": {
    "zh-Hans": "已关闭（仅本机监听）",
    "zh-Hant": "已關閉（僅本機監聽）",
    "fa": "غیرفعال (فقط loopback)",
    "ru": "Отключено (только loopback)",
  },
  "Configuration and rules": {
    "zh-Hans": "配置与规则",
    "zh-Hant": "設定與規則",
    "fa": "پیکربندی و قوانین",
    "ru": "Конфигурация и правила",
  },
  "Additional rules": {
    "zh-Hans": "附加规则",
    "zh-Hant": "附加規則",
    "fa": "قوانین تکمیلی",
    "ru": "Дополнительные правила",
  },
  "Edit route.rules and write them back to the configuration": {
    "zh-Hans": "编辑 route.rules 并写回配置",
    "zh-Hant": "編輯 route.rules 並寫回設定",
    "fa": "ویرایش route.rules و نوشتن آن در پیکربندی",
    "ru": "Редактировать route.rules и записать в конфигурацию",
  },
  "rule_set remote rule sets": {
    "zh-Hans": "rule_set 远程规则集",
    "zh-Hant": "rule_set 遠端規則集",
    "fa": "مجموعه‌قوانین‌های راه‌دور rule_set",
    "ru": "Удалённые наборы правил rule_set",
  },
  "JSON configuration editor (with validation, backup, and restore)": {
    "zh-Hans": "JSON 配置编辑器（含校验、备份、恢复）",
    "zh-Hant": "JSON 設定編輯器（含驗證、備份、還原）",
    "fa": "ویرایشگر پیکربندی JSON (با اعتبارسنجی، پشتیبان‌گیری و بازگردانی)",
    "ru": "Редактор конфигурации JSON (с проверкой, резервным копированием и восстановлением)",
  },
  "Diagnostics": {
    "zh-Hans": "诊断",
    "zh-Hant": "診斷",
    "fa": "عیب‌یابی",
    "ru": "Диагностика",
  },
  "Network quality": {
    "zh-Hans": "网络质量",
    "zh-Hant": "網路品質",
    "fa": "کیفیت شبکه",
    "ru": "Качество сети",
  },
  "STUN test": {
    "zh-Hans": "STUN 测试",
    "zh-Hant": "STUN 測試",
    "fa": "تست STUN",
    "ru": "Тест STUN",
  },
  "Connectivity diagnostics": {
    "zh-Hans": "连通性诊断",
    "zh-Hant": "連通性診斷",
    "fa": "عیب‌یابی اتصال",
    "ru": "Диагностика связности",
  },
  "Enable virtual adapter": {
    "zh-Hans": "开启虚拟网卡",
    "zh-Hant": "開啟虛擬網卡",
    "fa": "فعال‌کردن کارت شبکه مجازی",
    "ru": "Включить виртуальный адаптер",
  },
  "Disable virtual adapter": {
    "zh-Hans": "关闭虚拟网卡",
    "zh-Hant": "關閉虛擬網卡",
    "fa": "غیرفعال‌کردن کارت شبکه مجازی",
    "ru": "Отключить виртуальный адаптер",
  },
  "The previously saved TUN inbound will be restored to the configuration and the core restarted.": {
    "zh-Hans": "将把之前保存的 TUN 入站恢复到配置中，并重启内核。",
    "zh-Hant": "將把之前儲存的 TUN 入站恢復到設定中，並重啟核心。",
    "fa": "ورودی TUN ذخیره‌شده به پیکربندی بازگردانده و هسته دوباره راه‌اندازی می‌شود.",
    "ru": "Сохранённый входящий TUN будет возвращён в конфигурацию, а ядро перезапущено.",
  },
  "The TUN inbound will be removed from the configuration and saved as a preset so you can restore it later.": {
    "zh-Hans": "将从配置中移除 TUN 入站并保存为预设，方便之后恢复。",
    "zh-Hant": "將從設定中移除 TUN 入站並儲存為預設，方便之後恢復。",
    "fa": "ورودی TUN از پیکربندی حذف و به‌عنوان پیش‌تنظیم ذخیره می‌شود تا بعداً بازگردانی کنید.",
    "ru": "Входящий TUN будет удалён из конфигурации и сохранён как пресет для последующего восстановления.",
  },
  "Enable LAN proxy": {
    "zh-Hans": "开启局域网代理",
    "zh-Hant": "開啟區域網路代理",
    "fa": "فعال‌کردن پروکسی LAN",
    "ru": "Включить прокси в локальной сети",
  },
  "Disable LAN proxy": {
    "zh-Hans": "关闭局域网代理",
    "zh-Hant": "關閉區域網路代理",
    "fa": "غیرفعال‌کردن پروکسی LAN",
    "ru": "Отключить прокси в локальной сети",
  },
  "The local inbound listener will switch to 0.0.0.0 and the core will restart; make sure your firewall allows it.": {
    "zh-Hans": "将把本地入站监听切换为 0.0.0.0 并重启内核；请确认防火墙已放行。",
    "zh-Hant": "將把本機入站監聽切換為 0.0.0.0 並重啟核心；請確認防火牆已放行。",
    "fa": "شنونده ورودی محلی به 0.0.0.0 تغییر می‌کند و هسته دوباره راه‌اندازی می‌شود؛ مطمئن شوید فایروال اجازه می‌دهد.",
    "ru": "Локальный входящий слушатель переключится на 0.0.0.0, ядро перезапустится; убедитесь, что фаервол разрешает это.",
  },
  "The local inbound listener will switch back to 127.0.0.1 and the core will restart.": {
    "zh-Hans": "将把本地入站监听切回 127.0.0.1 并重启内核。",
    "zh-Hant": "將把本機入站監聽切回 127.0.0.1 並重啟核心。",
    "fa": "شنونده ورودی محلی به 127.0.0.1 بازمی‌گردد و هسته دوباره راه‌اندازی می‌شود.",
    "ru": "Локальный входящий слушатель вернётся на 127.0.0.1, ядро перезапустится.",
  },

  /* ── backup view ── */
  "Backup failed": {
    "zh-Hans": "备份失败",
    "zh-Hant": "備份失敗",
    "fa": "پشتیبان‌گیری ناموفق بود",
    "ru": "Не удалось создать резервную копию",
  },
  "Restore failed": {
    "zh-Hans": "恢复失败",
    "zh-Hant": "還原失敗",
    "fa": "بازگردانی ناموفق بود",
    "ru": "Не удалось восстановить",
  },
  "Backup requires the panel backend; unavailable in direct mode.": {
    "zh-Hans": "备份功能需要面板后端；直接模式下不可用。",
    "zh-Hant": "備份功能需要面板後端；直接模式下無法使用。",
    "fa": "پشتیبان‌گیری به بک‌اند پنل نیاز دارد؛ در حالت مستقیم در دسترس نیست.",
    "ru": "Резервное копирование требует бэкенда панели; в прямом режиме недоступно.",
  },
  "Back up now": {
    "zh-Hans": "立即备份",
    "zh-Hant": "立即備份",
    "fa": "همین حالا پشتیبان بگیرید",
    "ru": "Создать резервную копию",
  },
  "No backups": {
    "zh-Hans": "暂无备份",
    "zh-Hant": "尚無備份",
    "fa": "هیچ پشتیبانی وجود ندارد",
    "ru": "Резервных копий нет",
  },
  "Download backup": {
    "zh-Hans": "下载备份",
    "zh-Hant": "下載備份",
    "fa": "دانلود پشتیبان",
    "ru": "Скачать резервную копию",
  },
  "Restoring a backup overwrites the current configuration and restarts the core; the panel creates a fresh backup before every apply.": {
    "zh-Hans": "恢复备份会覆盖当前配置并重启内核；应用任何配置前面板都会自动创建新的备份。",
    "zh-Hant": "還原備份會覆寫目前設定並重啟核心；套用任何設定前面板都會自動建立新的備份。",
    "fa": "بازگردانی پشتیبان پیکربندی فعلی را بازنویسی و هسته را دوباره راه‌اندازی می‌کند؛ پنل پیش از هر اعمال، پشتیبان تازه می‌سازد.",
    "ru": "Восстановление копии перезапишет текущую конфигурацию и перезапустит ядро; перед каждым применением панель создаёт свежую копию.",
  },
  "Restore the configuration to “{name}” and restart the core? Changes that were not backed up will be lost.": {
    "zh-Hans": "将配置恢复到 “{name}” 并重启内核？当前未备份的修改会丢失。",
    "zh-Hant": "將設定還原到 “{name}” 並重啟核心？目前未備份的修改會遺失。",
    "fa": "پیکربندی به “{name}” بازگردانده و هسته دوباره راه‌اندازی شود؟ تغییرات پشتیبان‌گیری‌نشده از دست می‌روند.",
    "ru": "Восстановить конфигурацию из «{name}» и перезапустить ядро? Несохранённые изменения будут потеряны.",
  },

  /* ── resources view ── */
  "Total upload": {
    "zh-Hans": "累计上传",
    "zh-Hant": "累計上傳",
    "fa": "کل آپلود",
    "ru": "Всего отправлено",
  },
  "Total download": {
    "zh-Hans": "累计下载",
    "zh-Hant": "累計下載",
    "fa": "کل دانلود",
    "ru": "Всего получено",
  },
  "Kernel version": {
    "zh-Hans": "内核版本",
    "zh-Hant": "核心版本",
    "fa": "نسخه هسته",
    "ru": "Версия ядра",
  },
  "Traffic capture": {
    "zh-Hans": "流量接管",
    "zh-Hant": "流量接管",
    "fa": "تصاحب ترافیک",
    "ru": "Перехват трафика",
  },
  "eBPF (kernel space)": {
    "zh-Hans": "eBPF（内核态）",
    "zh-Hant": "eBPF（核心態）",
    "fa": "eBPF (فضای هسته)",
    "ru": "eBPF (ядро)",
  },
  "TUN (virtual adapter)": {
    "zh-Hans": "TUN（虚拟网卡）",
    "zh-Hant": "TUN（虛擬網卡）",
    "fa": "TUN (کارت شبکه مجازی)",
    "ru": "TUN (виртуальный адаптер)",
  },
  "Panel service": {
    "zh-Hans": "面板服务",
    "zh-Hant": "面板服務",
    "fa": "سرویس پنل",
    "ru": "Служба панели",
  },

  /* ── rule sets view ── */
  "No rule_set resources in the configuration": {
    "zh-Hans": "配置中没有 rule_set 资源",
    "zh-Hant": "設定中沒有 rule_set 資源",
    "fa": "هیچ منبع rule_set در پیکربندی نیست",
    "ru": "В конфигурации нет ресурсов rule_set",
  },
  "The kernel refreshes rule sets from the configuration; edit route.rule_set in the configuration file to add or change one.": {
    "zh-Hans": "规则集由内核按配置刷新；添加或修改请在配置文件中编辑 route.rule_set。",
    "zh-Hant": "規則集由核心依設定重新整理；新增或修改請在設定檔案中編輯 route.rule_set。",
    "fa": "مجموعه‌قوانین‌ها توسط هسته و بر اساس پیکربندی به‌روز می‌شوند؛ برای افزودن یا تغییر، route.rule_set را در فایل پیکربندی ویرایش کنید.",
    "ru": "Наборы правил обновляются ядром по конфигурации; чтобы добавить или изменить, отредактируйте route.rule_set в файле конфигурации.",
  },

  /* ── rules view ── */
  "Configuration validation failed; nothing was applied": {
    "zh-Hans": "配置校验失败，未应用",
    "zh-Hant": "設定驗證失敗，未套用",
    "fa": "اعتبارسنجی پیکربندی ناموفق بود؛ چیزی اعمال نشد",
    "ru": "Проверка конфигурации не прошла; ничего не применено",
  },
  "Rule editing requires the panel backend; unavailable in direct mode.": {
    "zh-Hans": "规则编辑需要面板后端；直接模式下不可用。",
    "zh-Hant": "規則編輯需要面板後端；直接模式下無法使用。",
    "fa": "ویرایش قوانین به بک‌اند پنل نیاز دارد؛ در حالت مستقیم در دسترس نیست.",
    "ru": "Редактирование правил требует бэкенда панели; в прямом режиме недоступно.",
  },
  "Routing rules": {
    "zh-Hans": "路由规则",
    "zh-Hant": "路由規則",
    "fa": "قوانین مسیریابی",
    "ru": "Правила маршрутизации",
  },
  "Trace simulation": {
    "zh-Hans": "追踪模拟",
    "zh-Hant": "追蹤模擬",
    "fa": "شبیه‌سازی ردیابی",
    "ru": "Симуляция трассировки",
  },
  "Unapplied staged changes {scope}; applying validates the configuration and hot-reloads the core.": {
    "zh-Hans": "有未应用的暂存改动{scope}，应用时会校验配置并热更新内核。",
    "zh-Hant": "有未套用的暫存變更{scope}，套用時會驗證設定並熱更新核心。",
    "fa": "تغییرات ذخیره‌شده اعمال‌نشده {scope}؛ اعمال، پیکربندی را اعتبارسنجی و هسته را زنده بازبارگذاری می‌کند.",
    "ru": "Неприменённые изменения {scope}; при применении конфигурация проверяется, ядро перезагружается на лету.",
  },
  "(routing + DNS)": {
    "zh-Hans": "（路由 + DNS）",
    "zh-Hant": "（路由 + DNS）",
    "fa": " (مسیریابی + DNS)",
    "ru": " (маршрутизация + DNS)",
  },
  "(routing rules)": {
    "zh-Hans": "（路由规则）",
    "zh-Hant": "（路由規則）",
    "fa": " (قوانین مسیریابی)",
    "ru": " (правила маршрутизации)",
  },
  "(DNS rules)": {
    "zh-Hans": "（DNS 规则）",
    "zh-Hant": "（DNS 規則）",
    "fa": " (قوانین DNS)",
    "ru": " (правила DNS)",
  },

  /* ── theme view ── */
  "Theme mode": {
    "zh-Hans": "主题模式",
    "zh-Hant": "主題模式",
    "fa": "حالت زمینه",
    "ru": "Режим темы",
  },
  "Dark mode uses a pure black background (AMOLED friendly)": {
    "zh-Hans": "深色模式下使用纯黑背景（AMOLED 友好）",
    "zh-Hant": "深色模式下使用純黑背景（AMOLED 友善）",
    "fa": "حالت تیره از پس‌زمینه کاملاً سیاه استفاده می‌کند (مناسب AMOLED)",
    "ru": "В тёмном режиме используется чисто чёрный фон (дружелюбно к AMOLED)",
  },
  "Accent color": {
    "zh-Hans": "主题色彩",
    "zh-Hant": "主題色彩",
    "fa": "رنگ تأکیدی",
    "ru": "Акцентный цвет",
  },
  "Accent color: {name}": {
    "zh-Hans": "主题色彩：{name}",
    "zh-Hant": "主題色彩：{name}",
    "fa": "رنگ تأکیدی: {name}",
    "ru": "Акцентный цвет: {name}",
  },

  /* ── DNS rules tab ── */
  "DNS rules match in order; the server must be a tag defined in dns.servers, and matching queries are handed to that upstream.": {
    "zh-Hans": "DNS 规则按顺序匹配；「服务器」需为 dns.servers 中已定义的 tag，命中后该查询交给对应上游处理。",
    "zh-Hant": "DNS 規則依序匹配；「伺服器」需為 dns.servers 中已定義的 tag，命中後該查詢交給對應上游處理。",
    "fa": "قوانین DNS به ترتیب مطابقت داده می‌شوند؛ سرور باید tag تعریف‌شده در dns.servers باشد و پرس‌وجوهای منطبق به همان بالادست سپرده می‌شوند.",
    "ru": "Правила DNS сопоставляются по порядку; сервер должен быть тегом из dns.servers, и совпавшие запросы уходят к этому upstream.",
  },
  "Add DNS rule": {
    "zh-Hans": "添加 DNS 规则",
    "zh-Hant": "新增 DNS 規則",
    "fa": "افزودن قانون DNS",
    "ru": "Добавить правило DNS",
  },
  "No DNS rules": {
    "zh-Hans": "暂无 DNS 规则",
    "zh-Hant": "尚無 DNS 規則",
    "fa": "هیچ قانون DNS وجود ندارد",
    "ru": "Правил DNS нет",
  },

  /* ── route rules tab ── */
  "Fixed matchers": {
    "zh-Hans": "固定匹配器",
    "zh-Hant": "固定匹配器",
    "fa": "تطبیق‌دهنده‌های ثابت",
    "ru": "Фиксированные сопоставители",
  },
  "References rule sets {tags}": {
    "zh-Hans": "引用规则集 {tags}",
    "zh-Hant": "引用規則集 {tags}",
    "fa": "ارجاع به مجموعه‌قوانین‌ها {tags}",
    "ru": "Ссылается на наборы правил {tags}",
  },
  "Static domain suffixes: {count}": {
    "zh-Hans": "静态域名后缀 {count} 条",
    "zh-Hant": "靜態網域後綴 {count} 條",
    "fa": "پسوندهای دامنه ثابت: {count}",
    "ru": "Статических доменных суффиксов: {count}",
  },
  "Prefer an existing rule_set in the configuration; more accurate than a static list": {
    "zh-Hans": "优先引用配置中已有的 rule_set，比静态列表更准确",
    "zh-Hant": "優先引用設定中已有的 rule_set，比靜態清單更準確",
    "fa": "از rule_set موجود در پیکربندی استفاده می‌شود؛ دقیق‌تر از فهرست ثابت است",
    "ru": "Используется существующий rule_set из конфигурации; точнее статического списка",
  },
  "No matching rule_set in the configuration; a static domain suffix list will be written": {
    "zh-Hans": "配置中没有对应 rule_set，写入静态域名后缀列表",
    "zh-Hant": "設定中沒有對應 rule_set，寫入靜態網域後綴清單",
    "fa": "rule_set متناظر در پیکربندی نیست؛ فهرست ثابت پسوند دامنه نوشته می‌شود",
    "ru": "В конфигурации нет подходящего rule_set; будет записан статический список доменных суффиксов",
  },
  "Already in the list": {
    "zh-Hans": "已在列表",
    "zh-Hant": "已在清單",
    "fa": "از قبل در فهرست است",
    "ru": "Уже в списке",
  },
  "Template target outbound": {
    "zh-Hans": "模板目标出站",
    "zh-Hant": "模板目標出站",
    "fa": "خروجی هدف قالب",
    "ru": "Целевой outbound шаблона",
  },
  "New routing template rules point at this outbound": {
    "zh-Hans": "新增「路由」类模板规则指向该出站",
    "zh-Hant": "新增「路由」類模板規則指向該出站",
    "fa": "قوانین قالب مسیریابی جدید به این خروجی اشاره می‌کنند",
    "ru": "Новые правила-шаблоны маршрутизации указывают на этот outbound",
  },
  "New routing template rules point at this outbound (current: {outbound})": {
    "zh-Hans": "新增「路由」类模板规则指向该出站（当前：{outbound}）",
    "zh-Hant": "新增「路由」類模板規則指向該出站（目前：{outbound}）",
    "fa": "قوانین قالب مسیریابی جدید به این خروجی اشاره می‌کنند (فعلی: {outbound})",
    "ru": "Новые правила-шаблоны маршрутизации указывают на этот outbound (текущий: {outbound})",
  },
  "Rule editing mode": {
    "zh-Hans": "规则编辑模式",
    "zh-Hant": "規則編輯模式",
    "fa": "حالت ویرایش قانون",
    "ru": "Режим редактирования правил",
  },
  "Simple": {
    "zh-Hans": "简易",
    "zh-Hant": "簡易",
    "fa": "ساده",
    "ru": "Простой",
  },
  "Advanced": {
    "zh-Hans": "高级",
    "zh-Hant": "進階",
    "fa": "پیشرفته",
    "ru": "Расширенный",
  },
  "More templates": {
    "zh-Hans": "更多模板",
    "zh-Hant": "更多模板",
    "fa": "قالب‌های بیشتر",
    "ru": "Больше шаблонов",
  },
  "Templates only generate one rule and stage it; switch to Advanced for finer domain/IP control. Private, multicast, and reserved addresses are better routed directly — use the “Direct private addresses” template and move it to the top. Changes are written to the configuration only after you press Apply.": {
    "zh-Hans": "模板只生成一条规则并加入暂存；更细的域名/IP 控制请切到「高级」。私有/多播/保留地址建议直连，可用「私有地址直连」模板并上移到列表前部。所有改动需点顶部「应用」后才写入配置。",
    "zh-Hant": "模板只產生一條規則並加入暫存；更細的網域/IP 控制請切到「進階」。私有/多播/保留位址建議直連，可用「私有位址直連」模板並上移到清單前部。所有變更需點頂部「套用」後才寫入設定。",
    "fa": "قالب‌ها فقط یک قانون می‌سازند و آن را ذخیره می‌کنند؛ برای کنترل دقیق‌تر دامنه/IP به «پیشرفته» بروید. آدرس‌های خصوصی، multicast و reserved بهتر است مستقیم مسیریابی شوند — از قالب «اتصال مستقیم آدرس‌های خصوصی» استفاده کنید و آن را به بالای فهرست ببرید. تغییرات فقط پس از فشردن «اعمال» در پیکربندی نوشته می‌شوند.",
    "ru": "Шаблоны создают только одно правило и откладывают его; для более точного контроля домена/IP перейдите в «Расширенный». Частные, multicast- и зарезервированные адреса лучше направлять напрямую — используйте шаблон «Прямое подключение частных адресов» и поднимите его в начало списка. Изменения записываются в конфигурацию только после нажатия «Применить».",
  },
  "Rule templates": {
    "zh-Hans": "规则模板",
    "zh-Hant": "規則模板",
    "fa": "قالب‌های قانون",
    "ru": "Шаблоны правил",
  },
  "Clicking add stages the rule; apply them together": {
    "zh-Hans": "点击添加后进入暂存，统一应用",
    "zh-Hant": "點擊新增後進入暫存，統一套用",
    "fa": "با کلیک روی افزودن، قانون ذخیره می‌شود؛ همه را با هم اعمال کنید",
    "ru": "Добавление откладывает правило; применяйте все вместе",
  },
  "No rules": {
    "zh-Hans": "暂无规则",
    "zh-Hant": "尚無規則",
    "fa": "هیچ قانونی وجود ندارد",
    "ru": "Правил нет",
  },

  /* ── trace rules tab ── */
  "Match": {
    "zh-Hans": "命中",
    "zh-Hant": "命中",
    "fa": "منطبق",
    "ru": "Совпадение",
  },
  "No match": {
    "zh-Hans": "未命中",
    "zh-Hant": "未命中",
    "fa": "بدون تطابق",
    "ru": "Нет совпадения",
  },
  "Requires the kernel": {
    "zh-Hans": "需内核判定",
    "zh-Hant": "需核心判定",
    "fa": "نیازمند تصمیم هسته",
    "ru": "Требуется решение ядра",
  },
  "Matched rule #{index}: {action}": {
    "zh-Hans": "命中规则 #{index}：{action}",
    "zh-Hant": "命中規則 #{index}：{action}",
    "fa": "قانون #{index} منطبق شد: {action}",
    "ru": "Совпало правило #{index}: {action}",
  },
  "No rule matched; using the default outbound (final)": {
    "zh-Hans": "未命中任何规则，走默认出站（final）",
    "zh-Hant": "未命中任何規則，走預設出站（final）",
    "fa": "هیچ قانونی منطبق نشد؛ استفاده از خروجی پیش‌فرض (final)",
    "ru": "Ни одно правило не совпало; используется outbound по умолчанию (final)",
  },
  "Stopped at rule #{index}: {reason}": {
    "zh-Hans": "在规则 #{index} 处停止：{reason}",
    "zh-Hant": "在規則 #{index} 處停止：{reason}",
    "fa": "در قانون #{index} متوقف شد: {reason}",
    "ru": "Остановлено на правиле #{index}: {reason}",
  },
  "Result": {
    "zh-Hans": "结论",
    "zh-Hant": "結論",
    "fa": "نتیجه",
    "ru": "Результат",
  },
  "Result (default)": {
    "zh-Hans": "结论（默认）",
    "zh-Hant": "結論（預設）",
    "fa": "نتیجه (پیش‌فرض)",
    "ru": "Результат (по умолчанию)",
  },
  "Cannot fully determine": {
    "zh-Hans": "无法完全判定",
    "zh-Hant": "無法完全判定",
    "fa": "امکان تعیین کامل نیست",
    "ru": "Нельзя определить полностью",
  },
  "e.g. www.example.com; required by domain-based rules": {
    "zh-Hans": "如 www.example.com；域名类规则需要它",
    "zh-Hant": "如 www.example.com；網域類規則需要它",
    "fa": "مثلاً www.example.com؛ قوانین دامنه‌ای به آن نیاز دارند",
    "ru": "Например, www.example.com; нужно правилам по домену",
  },
  "Target IP": {
    "zh-Hans": "目标 IP",
    "zh-Hant": "目標 IP",
    "fa": "IP هدف",
    "ru": "Целевой IP",
  },
  "Optional; required by ip_cidr / geoip rules": {
    "zh-Hans": "可选；ip_cidr / geoip 规则需要它",
    "zh-Hant": "選填；ip_cidr / geoip 規則需要它",
    "fa": "اختیاری؛ قوانین ip_cidr / geoip به آن نیاز دارند",
    "ru": "Необязательно; нужно правилам ip_cidr / geoip",
  },
  "Optional; required by port / port_range rules": {
    "zh-Hans": "可选；port / port_range 规则需要它",
    "zh-Hant": "選填；port / port_range 規則需要它",
    "fa": "اختیاری؛ قوانین port / port_range به آن نیاز دارند",
    "ru": "Необязательно; нужно правилам port / port_range",
  },
  "The simulation evaluates rules statically in order and only covers matchers that can be decided directly, such as domain, IP, port, and network; rule_set contents, the geoip database, process rules, and combined logical rules are decided by the kernel, so results may be looser than the kernel's. It uses the rules on this page, including unapplied changes.": {
    "zh-Hans": "模拟按规则顺序静态求值，只覆盖域名 / IP / 端口 / 网络等可直接判定的匹配器；rule_set 内容、geoip 库、进程与逻辑组合规则由内核判定，结果可能比内核宽松。模拟基于当前页面（含未应用改动）的规则。",
    "zh-Hant": "模擬依規則順序靜態求值，只涵蓋網域 / IP / 連接埠 / 網路等可直接判定的匹配器；rule_set 內容、geoip 資料庫、程序與邏輯組合規則由核心判定，結果可能比核心寬鬆。模擬基於目前頁面（含未套用變更）的規則。",
    "fa": "شبیه‌سازی قوانین را به ترتیب و به‌صورت ایستا ارزیابی می‌کند و تنها تطبیق‌دهنده‌هایی را پوشش می‌دهد که مستقیماً قابل تصمیم‌گیری‌اند، مانند دامنه، IP، پورت و شبکه؛ محتوای rule_set، پایگاه geoip، قوانین فرآیند و قوانین منطقی ترکیبی توسط هسته تصمیم‌گیری می‌شوند، بنابراین نتیجه ممکن است سهل‌گیرانه‌تر از هسته باشد. شبیه‌سازی از قوانین همین صفحه (شامل تغییرات اعمال‌نشده) استفاده می‌کند.",
    "ru": "Симуляция статически вычисляет правила по порядку и охватывает только сопоставители, которые можно определить напрямую: домен, IP, порт и сеть; содержимое rule_set, база geoip, правила процессов и составные логические правила определяются ядром, поэтому результат может быть мягче, чем у ядра. Используются правила текущей страницы, включая неприменённые изменения.",
  },

  /* ── rule editor list ── */
  "(empty rule)": {
    "zh-Hans": "（空规则）",
    "zh-Hant": "（空規則）",
    "fa": "(قانون خالی)",
    "ru": "(пустое правило)",
  },
  "Search rules": {
    "zh-Hans": "搜索规则",
    "zh-Hant": "搜尋規則",
    "fa": "جستجوی قوانین",
    "ru": "Поиск правил",
  },
  "Delete rule": {
    "zh-Hans": "删除规则",
    "zh-Hant": "刪除規則",
    "fa": "حذف قانون",
    "ru": "Удалить правило",
  },
  "Edit rule": {
    "zh-Hans": "编辑规则",
    "zh-Hant": "編輯規則",
    "fa": "ویرایش قانون",
    "ru": "Изменить правило",
  },
  "Delete rule {index} ({summary})? Changes are staged; they take effect after you press Apply.": {
    "zh-Hans": "删除第 {index} 条规则（{summary}）？改动先暂存，点「应用」后生效。",
    "zh-Hant": "刪除第 {index} 條規則（{summary}）？變更先暫存，點「套用」後生效。",
    "fa": "قانون {index} ({summary}) حذف شود؟ تغییرات ذخیره می‌شوند و پس از اعمال اثر می‌کنند.",
    "ru": "Удалить правило {index} ({summary})? Изменения откладываются и вступят в силу после «Применить».",
  },

  /* ── manage view ── */
  "Test notification": {
    "zh-Hans": "测试通知",
    "zh-Hant": "測試通知",
    "fa": "اعلان آزمایشی",
    "ru": "Тестовое уведомление",
  },
} as const satisfies Record<string, Record<TranslatedLanguage, string | PluralForms>>;
