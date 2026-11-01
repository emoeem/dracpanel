/**
 * Service rule templates behind the "simple" mode of the route rules tab.
 *
 * Each template ships a static domain-suffix list so the generated rule always
 * passes `sing-box check` without external data. When the config already
 * defines a matching `rule_set` (route.rule_set[].tag), the template prefers
 * referencing it — the kernel-maintained list is strictly more accurate.
 */

import type { RuleObject } from "./ruleEditor";

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  /** "route" rules need an outbound target; "reject" rules do not. */
  action: "route" | "reject";
  /**
   * rule_set tags this template would rather use, best first. Every tag that
   * exists in the config is referenced; the static list is the fallback.
   */
  preferredRuleSets?: string[];
  domainSuffixes: string[];
  /**
   * Non-domain templates (QUIC block, private-address fallback) carry their
   * complete rule; it is written verbatim and ignores the outbound target.
   */
  staticRule?: RuleObject;
}

export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    id: "ai",
    name: "AI 服务",
    description: "OpenAI / Claude / Gemini / DeepSeek 等常见 AI 服务",
    action: "route",
    preferredRuleSets: ["geosite-openai", "geosite-ai", "geosite-anthropic"],
    domainSuffixes: [
      "openai.com",
      "chatgpt.com",
      "oaistatic.com",
      "oaiusercontent.com",
      "sora.com",
      "anthropic.com",
      "claude.ai",
      "gemini.google.com",
      "aistudio.google.com",
      "deepseek.com",
      "x.ai",
      "grok.com",
      "perplexity.ai",
      "pplx.ai",
      "mistral.ai",
      "huggingface.co",
      "hf.co",
      "cursor.com",
      "cursor.sh",
    ],
  },
  {
    id: "streaming",
    name: "流媒体",
    description: "YouTube / Netflix / Disney+ / Spotify 等视频与音乐平台",
    action: "route",
    preferredRuleSets: [
      "geosite-youtube",
      "geosite-netflix",
      "geosite-disney",
      "geosite-hbo",
      "geosite-spotify",
      "geosite-primetime",
    ],
    domainSuffixes: [
      "youtube.com",
      "ytimg.com",
      "googlevideo.com",
      "twitch.tv",
      "ttvnw.net",
      "netflix.com",
      "nflxvideo.net",
      "nflximg.net",
      "nflxso.net",
      "disneyplus.com",
      "dssott.com",
      "hulu.com",
      "max.com",
      "hbo.com",
      "primevideo.com",
      "amazonvideo.com",
      "paramountplus.com",
      "spotify.com",
      "scdn.co",
    ],
  },
  {
    id: "ads",
    name: "广告拦截",
    description: "常见广告 / 统计 / 埋点域名，动作为拒绝",
    action: "reject",
    preferredRuleSets: ["geosite-category-ads-all", "geosite-ads"],
    domainSuffixes: [
      "doubleclick.net",
      "googlesyndication.com",
      "googleadservices.com",
      "adservice.google.com",
      "adnxs.com",
      "adsrvr.org",
      "pubmatic.com",
      "rubiconproject.com",
      "scorecardresearch.com",
      "quantserve.com",
      "moatads.com",
      "amplitude.com",
      "appsflyer.com",
      "mixpanel.com",
      "hotjar.com",
      "cnzz.com",
      "umeng.com",
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Telegram 域名（IP 段仍建议使用 rule_set）",
    action: "route",
    preferredRuleSets: ["geosite-telegram"],
    domainSuffixes: ["telegram.org", "t.me", "tdesktop.com", "telesco.pe", "cdn-telegram.org"],
  },
  {
    id: "google",
    name: "Google 服务",
    description: "搜索、API 与账号服务（不含 YouTube，见流媒体模板）",
    action: "route",
    preferredRuleSets: ["geosite-google"],
    domainSuffixes: [
      "google.com",
      "googleapis.com",
      "gstatic.com",
      "googleusercontent.com",
      "g.co",
      "goo.gl",
      "recaptcha.net",
      "withgoogle.com",
    ],
  },
  {
    id: "github",
    name: "开发者服务",
    description: "GitHub / GitLab / Docker Hub / PyPI 等开发依赖",
    action: "route",
    preferredRuleSets: ["geosite-github", "geosite-dev"],
    domainSuffixes: [
      "github.com",
      "githubusercontent.com",
      "githubassets.com",
      "github.io",
      "gitlab.com",
      "stackoverflow.com",
      "docker.com",
      "docker.io",
      "ghcr.io",
      "gcr.io",
      "quay.io",
      "npmjs.com",
      "npmjs.org",
      "pypi.org",
      "pythonhosted.org",
      "crates.io",
    ],
  },
  {
    id: "china",
    name: "国内服务直连",
    description: "腾讯 / 百度 / 阿里 / 字节等国内常用站点直连",
    action: "route",
    preferredRuleSets: ["geosite-cn"],
    domainSuffixes: [
      "qq.com",
      "tencent.com",
      "baidu.com",
      "bilibili.com",
      "biliapi.net",
      "hdslb.com",
      "zhihu.com",
      "douyin.com",
      "ixigua.com",
      "toutiao.com",
      "163.com",
      "126.net",
      "jd.com",
      "taobao.com",
      "tmall.com",
      "alipay.com",
      "aliyuncs.com",
      "mi.com",
      "xiaomi.com",
      "weibo.com",
      "sina.com.cn",
      "meituan.com",
      "dianping.com",
      "ele.me",
    ],
  },
  {
    id: "apple",
    name: "Apple 服务",
    description: "Apple / iCloud 服务",
    action: "route",
    preferredRuleSets: ["geosite-apple"],
    domainSuffixes: [
      "apple.com",
      "icloud.com",
      "icloud-content.com",
      "me.com",
      "mzstatic.com",
      "cdn-apple.com",
      "apple-dns.net",
    ],
  },
  {
    id: "block-quic",
    name: "屏蔽 QUIC",
    description: "拒绝 UDP 443（QUIC/HTTP3），迫使浏览器回退到 TCP 代理",
    action: "reject",
    domainSuffixes: [],
    staticRule: { network: "udp", port: 443, action: "reject" },
  },
  {
    id: "private-direct",
    name: "私有地址直连",
    description: "RFC1918 / 回环 / 链路本地地址直连；建议添加后上移到列表前部",
    action: "route",
    domainSuffixes: [],
    staticRule: { ip_is_private: true, outbound: "direct" },
  },
];

/**
 * Builds the rule object a template produces. `availableRuleSets` is the
 * config's `route.rule_set[].tag` list; every preferred tag found there is
 * referenced (a union beats any single static approximation), and the static
 * suffix list is used only when none match.
 */
export function resolveTemplateRule(
  template: RuleTemplate,
  outbound: string,
  availableRuleSets: readonly string[],
): RuleObject {
  if (template.staticRule !== undefined) {
    // Fixed-shape templates are used verbatim; they carry their own outbound.
    return { ...template.staticRule };
  }
  const rule: RuleObject = { action: template.action };
  if (template.action === "route" && outbound.trim() !== "") {
    rule.outbound = outbound.trim();
  }
  const available = new Set(availableRuleSets);
  const sets = (template.preferredRuleSets ?? []).filter((tag) => available.has(tag));
  if (sets.length > 0) {
    rule.rule_set = sets;
  } else {
    rule.domain_suffix = [...template.domainSuffixes];
  }
  return rule;
}
