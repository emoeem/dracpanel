import type { PluralForms, TranslatedLanguage } from "../translations";

/**
 * Translation fragment owned by the policiesProfiles surface.
 *
 * Keys are the English source strings (same contract as translations.ts):
 * every entry must carry all four translated languages and keep the same
 * placeholders as the key itself.
 */
export const policiesProfilesMessages = {
  /* ── profiles: empty state, toolbar, add menu ── */
  "Profile management requires the panel backend; unavailable in direct mode.": {
    "zh-Hans": "配置管理需要面板后端；直接模式下不可用。",
    "zh-Hant": "配置管理需要面板後端；直接模式下不可用。",
    "fa": "مدیریت پیکربندی به بک‌اند پنل نیاز دارد؛ در حالت مستقیم در دسترس نیست.",
    "ru": "Управление конфигурациями требует панельного бэкенда; в прямом режиме недоступно.",
  },
  "Link": { "zh-Hans": "链接", "zh-Hant": "連結", "fa": "پیوند", "ru": "Ссылка" },
  "File": { "zh-Hans": "文件", "zh-Hant": "檔案", "fa": "فایل", "ru": "Файл" },
  "QR code": { "zh-Hans": "二维码", "zh-Hant": "二維碼", "fa": "کد QR", "ru": "QR-код" },
  "The panel backend has no local import endpoint": {
    "zh-Hans": "当前面板后端未提供本地导入接口",
    "zh-Hant": "目前面板後端未提供本機匯入介面",
    "fa": "بک‌اند پنل نقطهٔ ورود برای ورود محلی ندارد",
    "ru": "Бэкенд панели не предоставляет локальный импорт",
  },
  "Scan a QR code to import; use a link for now": {
    "zh-Hans": "需扫描二维码导入，可先使用链接",
    "zh-Hant": "需掃描二維碼匯入，可先使用連結",
    "fa": "برای ورود باید کد QR اسکن شود؛ فعلاً از پیوند استفاده کنید",
    "ru": "Импорт требует сканирования QR-кода; пока используйте ссылку",
  },
  "No profiles": {
    "zh-Hans": "暂无配置",
    "zh-Hant": "暫無配置",
    "fa": "پیکربندی‌ای نیست",
    "ru": "Нет конфигураций",
  },
  "Untitled profile": {
    "zh-Hans": "未命名配置",
    "zh-Hant": "未命名配置",
    "fa": "پیکربندی بدون نام",
    "ru": "Конфигурация без имени",
  },
  "Profile actions": {
    "zh-Hans": "配置操作",
    "zh-Hant": "配置操作",
    "fa": "عملیات پیکربندی",
    "ru": "Действия с конфигурацией",
  },

  /* ── profiles: add / QR / delete sheets ── */
  "Import nodes from a subscription link": {
    "zh-Hans": "从订阅链接导入节点",
    "zh-Hant": "從訂閱連結匯入節點",
    "fa": "ورود گره‌ها از پیوند اشتراک",
    "ru": "Импорт узлов по ссылке подписки",
  },
  "Adding...": {
    "zh-Hans": "添加中…",
    "zh-Hant": "新增中…",
    "fa": "در حال افزودن…",
    "ru": "Добавление…",
  },
  "Name (optional)": {
    "zh-Hans": "名称（可选）",
    "zh-Hant": "名稱（可選）",
    "fa": "نام (اختیاری)",
    "ru": "Имя (необязательно)",
  },
  "My subscription": {
    "zh-Hans": "我的订阅",
    "zh-Hant": "我的訂閱",
    "fa": "اشتراک من",
    "ru": "Моя подписка",
  },
  "Subscription URL": {
    "zh-Hans": "订阅链接",
    "zh-Hant": "訂閱連結",
    "fa": "نشانی اشتراک",
    "ru": "Ссылка подписки",
  },
  "Profile QR code": {
    "zh-Hans": "配置二维码",
    "zh-Hant": "配置二維碼",
    "fa": "کد QR پیکربندی",
    "ru": "QR-код конфигурации",
  },
  "Delete profile": {
    "zh-Hans": "删除配置",
    "zh-Hant": "刪除配置",
    "fa": "حذف پیکربندی",
    "ru": "Удалить конфигурацию",
  },
  "Delete “{name}”? The next “Write configuration” removes the matching nodes from the core configuration.": {
    "zh-Hans": "删除 “{name}”？下次“写入配置”时会从内核配置中移除对应节点。",
    "zh-Hant": "刪除 “{name}”？下次「寫入配置」時會從核心設定中移除對應節點。",
    "fa": "«{name}» حذف شود؟ در «نوشتن پیکربندی» بعدی، گره‌های متناظر از پیکربندی هسته حذف می‌شوند.",
    "ru": "Удалить «{name}»? При следующем «Записать конфигурацию» соответствующие узлы будут удалены из конфигурации ядра.",
  },
  "Failed: {error}": {
    "zh-Hans": "失败：{error}",
    "zh-Hant": "失敗：{error}",
    "fa": "خطا: {error}",
    "ru": "Ошибка: {error}",
  },
  "Sync": { "zh-Hans": "同步", "zh-Hant": "同步", "fa": "همگام‌سازی", "ru": "Синхронизировать" },
  "Copy link": {
    "zh-Hans": "复制链接",
    "zh-Hant": "複製連結",
    "fa": "رونوشت پیوند",
    "ru": "Копировать ссылку",
  },
  "Current profile": {
    "zh-Hans": "当前配置",
    "zh-Hant": "目前配置",
    "fa": "پیکربندی فعلی",
    "ru": "Текущая конфигурация",
  },
  "Open config editor": {
    "zh-Hans": "打开配置编辑器",
    "zh-Hant": "開啟配置編輯器",
    "fa": "بازکردن ویرایشگر پیکربندی",
    "ru": "Открыть редактор конфигурации",
  },
  "Enter a valid subscription URL (http/https)": {
    "zh-Hans": "请输入有效的订阅链接（http/https）",
    "zh-Hant": "請輸入有效的訂閱連結（http/https）",
    "fa": "یک نشانی اشتراک معتبر وارد کنید (http/https)",
    "ru": "Введите корректную ссылку подписки (http/https)",
  },
  "Failed to add the subscription": {
    "zh-Hans": "添加配置失败",
    "zh-Hant": "新增配置失敗",
    "fa": "افزودن اشتراک ناموفق بود",
    "ru": "Не удалось добавить подписку",
  },
  "Failed to import the subscription": {
    "zh-Hans": "导入配置失败",
    "zh-Hant": "匯入配置失敗",
    "fa": "ورود اشتراک ناموفق بود",
    "ru": "Не удалось импортировать подписку",
  },

  /* ── flows: topology, records ── */
  "Connection topology": {
    "zh-Hans": "连接拓扑",
    "zh-Hant": "連線拓撲",
    "fa": "توپولوژی اتصال‌ها",
    "ru": "Топология подключений",
  },
  "{dimension} → outbound → node paths; click a row to filter · {count} connections": {
    "zh-Hans": "按{dimension}查看出站与节点的路径，点击行可筛选；覆盖 {count} 条连接",
    "zh-Hant": "依{dimension}查看出站與節點的路徑，點擊列可篩選；涵蓋 {count} 條連線",
    "fa": "مسیرهای {dimension} → خروجی → گره؛ برای پالایش روی یک ردیف بزنید · {count} اتصال",
    "ru": "Пути {dimension} → исходящий → узел; нажмите на строку для фильтра · {count} подключений",
  },
  "Filtered by “{name}” · {count} connections": {
    "zh-Hans": "已按「{name}」筛选 · 覆盖 {count} 条连接",
    "zh-Hant": "已依「{name}」篩選 · 涵蓋 {count} 條連線",
    "fa": "پالایش بر اساس «{name}» · {count} اتصال",
    "ru": "Фильтр по «{name}» · {count} подключений",
  },
  "Clear path filter": {
    "zh-Hans": "清除路径筛选",
    "zh-Hant": "清除路徑篩選",
    "fa": "پاک‌کردن پالایش مسیر",
    "ru": "Сбросить фильтр пути",
  },
  "Topology dimension": {
    "zh-Hans": "拓扑维度",
    "zh-Hant": "拓撲維度",
    "fa": "بعد توپولوژی",
    "ru": "Измерение топологии",
  },
  "At most {count} items per column; the rest are truncated by count": {
    "zh-Hans": "每列最多显示 {count} 项，其余按计数截断。",
    "zh-Hant": "每欄最多顯示 {count} 項，其餘依計數截斷。",
    "fa": "حداکثر {count} مورد در هر ستون؛ بقیه بر اساس شمارش کوتاه می‌شوند",
    "ru": "Не более {count} элементов на столбец; остальные усечены по счётчику",
  },
  "{name} · {count} links · {bytes}": {
    "zh-Hans": "{name} · {count} 条 · {bytes}",
    "zh-Hant": "{name} · {count} 條 · {bytes}",
    "fa": "{name} · {count} پیوند · {bytes}",
    "ru": "{name} · {count} связей · {bytes}",
  },
  "Live snapshot · {count} active connections": {
    "zh-Hans": "实时快照 · {count} 条活动连接",
    "zh-Hant": "即時快照 · {count} 條活動連線",
    "fa": "عکس زنده · {count} اتصال فعال",
    "ru": "Живой снимок · {count} активных подключений",
  },
  "Flows view": {
    "zh-Hans": "分流视图",
    "zh-Hant": "分流檢視",
    "fa": "نمای جریان‌ها",
    "ru": "Вид потоков",
  },
  "Records": { "zh-Hans": "记录", "zh-Hant": "記錄", "fa": "سوابق", "ru": "Записи" },
  "Connection records": {
    "zh-Hans": "连接记录",
    "zh-Hant": "連線記錄",
    "fa": "سوابق اتصال‌ها",
    "ru": "Записи подключений",
  },
  "Current active connections, newest first; the live snapshot is not persisted": {
    "zh-Hans": "当前活动连接，按开始时间倒序；实时快照不持久化",
    "zh-Hant": "目前活動連線，依開始時間倒序；即時快照不持久化",
    "fa": "اتصال‌های فعال کنونی، تازه‌ترین ابتدا؛ عکس زنده ذخیره نمی‌شود",
    "ru": "Текущие активные подключения, новые первыми; живой снимок не сохраняется",
  },

  /* ── proxies: node cards ── */
  "Test latency again": {
    "zh-Hans": "重新测试延迟",
    "zh-Hant": "重新測試延遲",
    "fa": "آزمون دوبارهٔ تأخیر",
    "ru": "Проверить задержку снова",
  },
  "{name} (not selectable in the current group)": {
    "zh-Hans": "{name}（当前策略组不可选）",
    "zh-Hant": "{name}（目前策略群組不可選）",
    "fa": "{name} (در گروه فعلی قابل انتخاب نیست)",
    "ru": "{name} (недоступен в текущей группе)",
  },
} as const satisfies Record<string, Record<TranslatedLanguage, string | PluralForms>>;
