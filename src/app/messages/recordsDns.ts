import type { PluralForms, TranslatedLanguage } from "../translations";

/**
 * Translation fragment owned by the recordsDns surface.
 *
 * Keys are the English source strings (same contract as translations.ts):
 * every entry must carry all four translated languages and keep the same
 * placeholders as the key itself.
 */
export const recordsDnsMessages = {
  /* ── connections list ─────────────────────────────────────── */
  "No grouping": { "zh-Hans": "不分组", "zh-Hant": "不分組", "fa": "بدون گروه‌بندی", "ru": "Без группировки" },
  "By host": { "zh-Hans": "按主机", "zh-Hant": "依主機", "fa": "بر اساس میزبان", "ru": "По хосту" },
  "By process": { "zh-Hans": "按进程", "zh-Hant": "依進程", "fa": "بر اساس فرایند", "ru": "По процессу" },
  "By outbound": { "zh-Hans": "按出口", "zh-Hant": "依出口", "fa": "بر اساس خروجی", "ru": "По исходящему" },
  "By rule": { "zh-Hans": "按规则", "zh-Hant": "依規則", "fa": "بر اساس قانون", "ru": "По правилу" },
  "By device": { "zh-Hans": "按设备", "zh-Hant": "依裝置", "fa": "بر اساس دستگاه", "ru": "По устройству" },
  "Start time": { "zh-Hans": "开始时间", "zh-Hant": "開始時間", "fa": "زمان شروع", "ru": "Время начала" },
  "Host": { "zh-Hans": "主机", "zh-Hant": "主機", "fa": "میزبان", "ru": "Хост" },
  "Downloaded": { "zh-Hans": "下载总量", "zh-Hant": "下載總量", "fa": "دانلودشده", "ru": "Скачано" },
  "Uploaded": { "zh-Hans": "上传总量", "zh-Hant": "上傳總量", "fa": "آپلودشده", "ru": "Отправлено" },
  "Total traffic": { "zh-Hans": "总流量", "zh-Hant": "總流量", "fa": "کل ترافیک", "ru": "Общий трафик" },
  "Current rate": { "zh-Hans": "当前速率", "zh-Hant": "目前速率", "fa": "نرخ کنونی", "ru": "Текущая скорость" },
  "Download rate": { "zh-Hans": "下载速度", "zh-Hant": "下載速度", "fa": "سرعت دانلود", "ru": "Скорость загрузки" },
  "Upload rate": { "zh-Hans": "上传速度", "zh-Hant": "上傳速度", "fa": "سرعت آپلود", "ru": "Скорость отправки" },
  "Search connections": { "zh-Hans": "搜索连接", "zh-Hant": "搜尋連接", "fa": "جستجوی اتصال‌ها", "ru": "Поиск подключений" },
  "Connection view": { "zh-Hans": "连接视图", "zh-Hant": "連接視圖", "fa": "نمای اتصال‌ها", "ru": "Вид подключений" },
  "Connection state": { "zh-Hans": "连接状态", "zh-Hant": "連接狀態", "fa": "وضعیت اتصال", "ru": "Состояние подключения" },
  "Sort": { "zh-Hans": "排序", "zh-Hant": "排序", "fa": "مرتب‌سازی", "ru": "Сортировка" },
  "Close all connections": { "zh-Hans": "关闭全部连接", "zh-Hant": "關閉全部連接", "fa": "بستن همهٔ اتصال‌ها", "ru": "Закрыть все подключения" },
  "{count} rows · ↓{down} ↑{up}": { "zh-Hans": "{count} 条 · ↓{down} ↑{up}", "zh-Hant": "{count} 筆 · ↓{down} ↑{up}", "fa": "{count} ردیف · ↓{down} ↑{up}", "ru": "Строк: {count} · ↓{down} ↑{up}" },
  "Loading…": { "zh-Hans": "加载中…", "zh-Hant": "載入中…", "fa": "در حال بارگذاری…", "ru": "Загрузка…" },

  /* ── connection detail sheet ──────────────────────────────── */
  "Connection details": { "zh-Hans": "连接详情", "zh-Hant": "連接詳情", "fa": "جزئیات اتصال", "ru": "Детали подключения" },
  "Outbound chain": { "zh-Hans": "出口链", "zh-Hant": "出口鏈", "fa": "زنجیرهٔ خروجی", "ru": "Цепочка исходящих" },
  "Closing…": { "zh-Hans": "关闭中…", "zh-Hant": "關閉中…", "fa": "در حال بستن…", "ru": "Закрытие…" },

  /* ── requests ledger ──────────────────────────────────────── */
  "Recent requests": { "zh-Hans": "最近请求", "zh-Hant": "最近請求", "fa": "درخواست‌های اخیر", "ru": "Недавние запросы" },
  "Search requests": { "zh-Hans": "搜索请求", "zh-Hant": "搜尋請求", "fa": "جستجوی درخواست‌ها", "ru": "Поиск запросов" },
  "Requests are derived from live connection events; the core keeps no request history, so entries disappear after a restart.": {
    "zh-Hans": "请求列表由实时连接事件派生，核心不保留历史请求日志；重启后条目会消失。",
    "zh-Hant": "請求列表由即時連接事件衍生，核心不保留歷史請求日誌；重新啟動後條目會消失。",
    "fa": "فهرست درخواست‌ها از رویدادهای زندهٔ اتصال‌ها ساخته می‌شود؛ هسته تاریخچهٔ درخواست‌ها را نگه نمی‌دارد، پس موارد پس از راه‌اندازی دوباره پاک می‌شوند.",
    "ru": "Список запросов строится из событий активных подключений; ядро не хранит историю запросов, поэтому после перезапуска записи исчезают.",
  },

  /* ── traffic tab ──────────────────────────────────────────── */
  "Highest-traffic connection": { "zh-Hans": "最高流量连接", "zh-Hant": "最高流量連接", "fa": "پرترافیک‌ترین اتصال", "ru": "Подключение с наибольшим трафиком" },
  "Connection traffic": { "zh-Hans": "连接流量", "zh-Hant": "連接流量", "fa": "ترافیک اتصال‌ها", "ru": "Трафик подключений" },
  "{count} connections · x-axis upload / y-axis download": {
    "zh-Hans": "连接 {count} · 横轴上传 / 纵轴下载",
    "zh-Hant": "連接 {count} · 橫軸上傳 / 縱軸下載",
    "fa": "{count} اتصال · محور افقی آپلود / محور عمودی دانلود",
    "ru": "Подключений: {count} · ось X — отправка, ось Y — загрузка",
  },
  "Nodes with latency {withData} · no data {missing}": {
    "zh-Hans": "有延迟的节点 {withData} · 无数据 {missing}",
    "zh-Hant": "有延遲的節點 {withData} · 無資料 {missing}",
    "fa": "نودهای با تأخیر {withData} · بدون داده {missing}",
    "ru": "Узлов с задержкой: {withData} · без данных: {missing}",
  },
  "All nodes P50": { "zh-Hans": "全部节点 P50", "zh-Hant": "全部節點 P50", "fa": "همهٔ نودها P50", "ru": "Все узлы P50" },
  "All nodes P90": { "zh-Hans": "全部节点 P90", "zh-Hant": "全部節點 P90", "fa": "همهٔ نودها P90", "ru": "Все узлы P90" },
  "P50 weighted by connection count": {
    "zh-Hans": "按连接数加权 P50",
    "zh-Hant": "依連接數加權 P50",
    "fa": "P50 وزن‌دار بر پایهٔ شمار اتصال‌ها",
    "ru": "P50 с весом по числу подключений",
  },

  /* ── dns: tabs and status labels ──────────────────────────── */
  "Stats": { "zh-Hans": "统计", "zh-Hant": "統計", "fa": "آمار", "ru": "Статистика" },
  "Queries": { "zh-Hans": "解析记录", "zh-Hant": "解析記錄", "fa": "پرسش‌ها", "ru": "Запросы" },
  "Answered by upstream": { "zh-Hans": "上游应答", "zh-Hant": "上游應答", "fa": "پاسخ از بالادست", "ru": "Ответ вышестоящего сервера" },
  "Name not found": { "zh-Hans": "查无此名", "zh-Hant": "查無此名", "fa": "نام یافت نشد", "ru": "Имя не найдено" },

  /* ── dns: stats tab ───────────────────────────────────────── */
  "{count} rows": { "zh-Hans": "{count} 条", "zh-Hant": "{count} 筆", "fa": "{count} ردیف", "ru": "Строк: {count}" },
  "{count} rows · median {median} ms": {
    "zh-Hans": "{count} 条 · 中位数 {median} ms",
    "zh-Hant": "{count} 筆 · 中位數 {median} ms",
    "fa": "{count} ردیف · میانه {median} ms",
    "ru": "Строк: {count} · медиана {median} ms",
  },
  "No records carry upstream information; upstream latency needs debug-level DNS logs": {
    "zh-Hans": "没有带上游信息的记录；上游延迟需要 debug 级 DNS 日志",
    "zh-Hant": "沒有帶上游資訊的記錄；上游延遲需要 debug 等級 DNS 日誌",
    "fa": "هیچ ردیفی اطلاعات بالادست ندارد؛ تأخیر بالادست به گزارش‌های DNS در سطح debug نیاز دارد",
    "ru": "Нет записей со сведениями о вышестоящем сервере; задержка требует DNS-логов уровня debug",
  },
  "Median": { "zh-Hans": "中位数", "zh-Hant": "中位數", "fa": "میانه", "ru": "Медиана" },
  "{count} timed records": {
    "zh-Hans": "{count} 条带耗时记录",
    "zh-Hant": "{count} 筆含耗時記錄",
    "fa": "{count} رکورد زمان‌دار",
    "ru": "Записей с временем: {count}",
  },
  "Slow-query ceiling": { "zh-Hans": "慢查询上限", "zh-Hant": "慢查詢上限", "fa": "سقف پرسش‌های کند", "ru": "Верхняя граница медленных запросов" },
  "Cache hit rate (estimated)": { "zh-Hans": "缓存命中率（估算）", "zh-Hant": "快取命中率（估算）", "fa": "نرخ اصابت کش (تخمینی)", "ru": "Доля попаданий в кэш (оценка)" },
  "Answers without upstream attribution; estimate only": {
    "zh-Hans": "无上游归属的应答，仅供估算",
    "zh-Hant": "無上游歸屬的應答，僅供估算",
    "fa": "پاسخ‌های بدون انتساب بالادست؛ فقط تخمین",
    "ru": "Ответы без привязки к вышестоящему серверу; только оценка",
  },
  "Failure rate": { "zh-Hans": "失败率", "zh-Hant": "失敗率", "fa": "نرخ شکست", "ru": "Доля ошибок" },
  "{failed} / {total} rows": {
    "zh-Hans": "{failed} / {total} 条",
    "zh-Hant": "{failed} / {total} 筆",
    "fa": "{failed} / {total} ردیف",
    "ru": "{failed} / {total} строк",
  },
  "Cache hit (estimated)": { "zh-Hans": "缓存命中（估算）", "zh-Hant": "快取命中（估算）", "fa": "اصابت کش (تخمینی)", "ru": "Попадание в кэш (оценка)" },
  "Upstream query latency": {
    "zh-Hans": "上游查询延迟",
    "zh-Hant": "上游查詢延遲",
    "fa": "تأخیر پرسش بالادست",
    "ru": "Задержка запросов к вышестоящему серверу",
  },
  "{total} records · vertical axis is log order, horizontal axis is logarithmic latency": {
    "zh-Hans": "{total} 条记录 · 纵轴为日志时间顺序，横轴为对数耗时",
    "zh-Hant": "{total} 筆記錄 · 縱軸為日誌時間順序，橫軸為對數耗時",
    "fa": "{total} رکورد · محور عمودی ترتیب زمانی گزارش، محور افقی تأخیر لگاریتمی",
    "ru": "Записей: {total} · ось Y — порядок в журнале, ось X — логарифм задержки",
  },
  "Probing…": { "zh-Hans": "探测中…", "zh-Hant": "探測中…", "fa": "در حال کاوش…", "ru": "Проверка…" },
  "Probe upstream": { "zh-Hans": "探测上游", "zh-Hant": "探測上游", "fa": "کاوش بالادست", "ru": "Проверить вышестоящий сервер" },
  "Response outcomes": { "zh-Hans": "响应结果", "zh-Hant": "回應結果", "fa": "نتیجهٔ پاسخ‌ها", "ru": "Исходы ответов" },
  "Counted by rows; cache hits are an estimate": {
    "zh-Hans": "按条数统计；缓存命中为估算值",
    "zh-Hant": "依筆數統計；快取命中為估算值",
    "fa": "بر پایهٔ تعداد ردیف؛ اصابت کش تخمینی است",
    "ru": "Считается по строкам; попадания в кэш — оценка",
  },
  "Query ranking": { "zh-Hans": "查询排行", "zh-Hant": "查詢排行", "fa": "رتبه‌بندی پرسش‌ها", "ru": "Рейтинг запросов" },
  "Statistics rely on debug-level DNS logs. Enable collection on the “Queries” tab, or measure upstream latency directly with “Probe upstream”.": {
    "zh-Hans": "统计依赖 debug 级 DNS 日志。到「解析记录」标签开启采集，或使用「探测上游」直接测量上游延迟。",
    "zh-Hant": "統計依賴 debug 等級 DNS 日誌。到「解析記錄」分頁開啟擷取，或使用「探測上游」直接量測上游延遲。",
    "fa": "آمار به گزارش‌های DNS در سطح debug وابسته است. در زبانهٔ «پرسش‌ها» گردآوری را روشن کنید یا با «کاوش بالادست» تأخیر را مستقیم اندازه بگیرید.",
    "ru": "Статистика опирается на DNS-логи уровня debug. Включите сбор на вкладке «Запросы» или измерьте задержку напрямую через «Проверить вышестоящий сервер».",
  },

  /* ── dns: queries tab ─────────────────────────────────────── */
  "DNS record collection": { "zh-Hans": "DNS 记录采集", "zh-Hant": "DNS 記錄擷取", "fa": "گردآوری رکوردهای DNS", "ru": "Сбор DNS-записей" },
  "Enabled (log.level={level}): the core writes one log line per query": {
    "zh-Hans": "已开启（log.level={level}）：核心会为每条查询写一行日志",
    "zh-Hant": "已開啟（log.level={level}）：核心會為每筆查詢寫一行日誌",
    "fa": "فعال (log.level={level}): هسته برای هر پرسش یک خط گزارش می‌نویسد",
    "ru": "Включено (log.level={level}): ядро пишет по строке журнала на каждый запрос",
  },
  "Disabled (log.level={level}): only the debug level emits one line per query": {
    "zh-Hans": "未开启（log.level={level}）：仅 debug 级别输出每条查询",
    "zh-Hant": "未開啟（log.level={level}）：僅 debug 等級輸出每筆查詢",
    "fa": "غیرفعال (log.level={level}): فقط سطح debug هر پرسش را ثبت می‌کند",
    "ru": "Отключено (log.level={level}): только уровень debug пишет по строке на запрос",
  },
  "Not set": { "zh-Hans": "未设置", "zh-Hant": "未設定", "fa": "تنظیم‌نشده", "ru": "Не задано" },
  "Enable DNS record collection": {
    "zh-Hans": "开启 DNS 记录采集",
    "zh-Hant": "開啟 DNS 記錄擷取",
    "fa": "فعال‌کردن گردآوری رکوردهای DNS",
    "ru": "Включить сбор DNS-записей",
  },
  "Enabling switches log.level to debug, which noticeably increases log volume and disk usage; switch back to info after troubleshooting. Records come from the panel reading system logs; the core keeps no history.": {
    "zh-Hans": "开启会把 log.level 改为 debug，日志量与磁盘占用明显增加；排查完建议切回 info。记录来自面板读取系统日志，核心本身不保留历史。",
    "zh-Hant": "開啟會把 log.level 改為 debug，日誌量與磁碟占用明顯增加；排查完建議切回 info。記錄來自面板讀取系統日誌，核心本身不保留歷史。",
    "fa": "فعال‌کردن، log.level را به debug تغییر می‌دهد و حجم گزارش و مصرف دیسک را چشمگیر می‌کند؛ پس از عیب‌یابی به info بازگردید. رکوردها از خواندن گزارش سامانه توسط پنل می‌آیند و هسته تاریخی نگه نمی‌دارد.",
    "ru": "Включение меняет log.level на debug: объём логов и расход диска заметно растут; после диагностики верните info. Записи берутся из системного журнала, ядро историю не хранит.",
  },
  "Search domain / type / device / upstream": {
    "zh-Hans": "搜索域名 / 类型 / 设备 / 上游",
    "zh-Hant": "搜尋網域 / 類型 / 裝置 / 上游",
    "fa": "جستجوی دامنه / نوع / دستگاه / بالادست",
    "ru": "Поиск: домен / тип / устройство / вышестоящий сервер",
  },
  "Refreshing…": { "zh-Hans": "刷新中…", "zh-Hant": "重新整理中…", "fa": "در حال نوسازی…", "ru": "Обновление…" },
  "Upstream": { "zh-Hans": "上游", "zh-Hant": "上游", "fa": "بالادست", "ru": "Вышестоящий сервер" },
  "Result": { "zh-Hans": "结果", "zh-Hant": "結果", "fa": "نتیجه", "ru": "Результат" },
  "No records": { "zh-Hans": "暂无记录", "zh-Hant": "暫無記錄", "fa": "رکوردی نیست", "ru": "Записей нет" },

  /* ── dns: cache tab ───────────────────────────────────────── */
  "DNS cache toggle": { "zh-Hans": "DNS 缓存开关", "zh-Hant": "DNS 快取開關", "fa": "کلید کش DNS", "ru": "Переключатель кэша DNS" },
  "Enabled (dns.cache_enabled)": {
    "zh-Hans": "已开启（dns.cache_enabled）",
    "zh-Hant": "已開啟（dns.cache_enabled）",
    "fa": "فعال (dns.cache_enabled)",
    "ru": "Включено (dns.cache_enabled)",
  },
  "Cache file": { "zh-Hans": "缓存文件", "zh-Hant": "快取檔案", "fa": "پروندهٔ کش", "ru": "Файл кэша" },
  "experimental.cache_file is not enabled": {
    "zh-Hans": "未启用 experimental.cache_file",
    "zh-Hant": "未啟用 experimental.cache_file",
    "fa": "experimental.cache_file فعال نیست",
    "ru": "experimental.cache_file не включён",
  },
  "Cache file updated": { "zh-Hans": "缓存文件更新", "zh-Hant": "快取檔案更新", "fa": "به‌روزرسانی پروندهٔ کش", "ru": "Обновление файла кэша" },
  "Cache options": { "zh-Hans": "缓存配置项", "zh-Hant": "快取設定項", "fa": "گزینه‌های کش", "ru": "Параметры кэша" },
  "Cache status": { "zh-Hans": "缓存状态", "zh-Hant": "快取狀態", "fa": "وضعیت کش", "ru": "Состояние кэша" },
  "From the current config and cache file": {
    "zh-Hans": "来自当前配置与缓存文件",
    "zh-Hant": "來自目前設定與快取檔案",
    "fa": "از پیکربندی کنونی و پروندهٔ کش",
    "ru": "Из текущего конфига и файла кэша",
  },
  "Clearing…": { "zh-Hans": "清除中…", "zh-Hant": "清除中…", "fa": "در حال پاک‌سازی…", "ru": "Очистка…" },
  "Clear DNS cache": { "zh-Hans": "清除 DNS 缓存", "zh-Hant": "清除 DNS 快取", "fa": "پاک‌کردن کش DNS", "ru": "Очистить кэш DNS" },
  "Clear FakeIP cache": { "zh-Hans": "清除 FakeIP 缓存", "zh-Hant": "清除 FakeIP 快取", "fa": "پاک‌کردن کش FakeIP", "ru": "Очистить кэш FakeIP" },
  "Cache entries": { "zh-Hans": "缓存条目", "zh-Hant": "快取項目", "fa": "ورودی‌های کش", "ru": "Записи кэша" },
  "sing-box exposes no cache-content API": {
    "zh-Hans": "sing-box 不提供缓存内容接口",
    "zh-Hant": "sing-box 不提供快取內容介面",
    "fa": "sing-box هیچ API برای محتوای کش ارائه نمی‌دهد",
    "ru": "sing-box не предоставляет API содержимого кэша",
  },
  "The core only exposes “flush”; entries and their TTL cannot be listed, so this is stated honestly instead of faking data. For entry-level troubleshooting, enable debug logs and check the actual queries under “Queries”.": {
    "zh-Hans": "核心只暴露「清空」，无法列出缓存条目或其 TTL；此处如实标注而不伪造数据。需要条目级排查时请开启 debug 日志，在「解析记录」中查看实际查询。",
    "zh-Hant": "核心只暴露「清空」，無法列出快取項目或其 TTL；此處如實標註而不偽造資料。需要項目級排查時請開啟 debug 日誌，在「解析記錄」中檢視實際查詢。",
    "fa": "هسته فقط «پاک‌سازی» را ارائه می‌دهد و نمی‌تواند ورودی‌های کش یا TTL آن‌ها را فهرست کند؛ اینجا صادقانه ذکر شده و داده‌ای جعل نمی‌شود. برای بررسی در سطح ورودی، گزارش debug را روشن کنید و پرسش‌های واقعی را در «پرسش‌ها» ببینید.",
    "ru": "Ядро умеет только «очищать»: списка записей кэша и их TTL нет, поэтому здесь честная пометка вместо выдуманных данных. Для разбора на уровне записей включите debug-логи и смотрите фактические запросы на вкладке «Запросы».",
  },

  /* ── dns: lookup tab and page chrome ──────────────────────── */
  "Issued through the core's Clash API using the current DNS config": {
    "zh-Hans": "经核心的 Clash API 发起，使用当前 DNS 配置",
    "zh-Hant": "經核心的 Clash API 發起，使用目前 DNS 設定",
    "fa": "از طریق Clash API هسته و با پیکربندی کنونی DNS انجام می‌شود",
    "ru": "Запрос идёт через Clash API ядра с текущим конфигом DNS",
  },
  "Querying…": { "zh-Hans": "查询中…", "zh-Hant": "查詢中…", "fa": "در حال پرسش…", "ru": "Запрос…" },
  "Panel": { "zh-Hans": "面板", "zh-Hant": "面板", "fa": "پنل", "ru": "Панель" },
  "DNS statistics require the panel backend; unavailable in direct mode.": {
    "zh-Hans": "DNS 统计需要面板后端；直接模式下不可用。",
    "zh-Hant": "DNS 統計需要面板後端；直接模式下不可用。",
    "fa": "آمار DNS به بک‌اند پنل نیاز دارد؛ در حالت مستقیم در دسترس نیست.",
    "ru": "Статистика DNS требует панельного бэкенда; в прямом режиме недоступна.",
  },
  "Domain resolution and cache contents": {
    "zh-Hans": "域名解析与缓存内容",
    "zh-Hant": "網域解析與快取內容",
    "fa": "تفکیک دامنه و محتوای کش",
    "ru": "Разрешение домён и содержимое кэша",
  },
  "Open DNS config": { "zh-Hans": "打开 DNS 配置", "zh-Hant": "開啟 DNS 設定", "fa": "بازکردن پیکربندی DNS", "ru": "Открыть конфиг DNS" },
  "DNS view": { "zh-Hans": "DNS 视图", "zh-Hant": "DNS 視圖", "fa": "نمای DNS", "ru": "Вид DNS" },
  "Failed to read config": { "zh-Hans": "读取配置失败", "zh-Hant": "讀取設定失敗", "fa": "خواندن پیکربندی ناموفق بود", "ru": "Не удалось прочитать конфиг" },
  "Config validation failed; nothing was applied": {
    "zh-Hans": "配置校验失败，未应用",
    "zh-Hant": "設定驗證失敗，未套用",
    "fa": "اعتبارسنجی پیکربندی ناموفق بود؛ چیزی اعمال نشد",
    "ru": "Проверка конфига не прошла, изменения не применены",
  },
  "Write failed": { "zh-Hans": "写入失败", "zh-Hant": "寫入失敗", "fa": "نوشتن ناموفق بود", "ru": "Не удалось записать" },
} as const satisfies Record<string, Record<TranslatedLanguage, string | PluralForms>>;
