# Contributing

感谢你愿意改动 DracPanel。这是一个**非官方** fork（上游
[SagerNet/sing-box-dashboard](https://github.com/SagerNet/sing-box-dashboard)，
GPL-3.0-or-later），改动请遵守上游许可证的要求（不得使用原名或暗示官方关联）。

改动前请先读 [README.md](README.md) 的“这是什么 / 架构 / 安全”三节，以及
[DEPLOYMENT.md](DEPLOYMENT.md)；本文件只讲**怎么改**，不讲**为什么这么设计**。

## 开发环境

- **Node.js**：`package.json` 没有 `engines` 字段，以 CI 为准 ——
  `.github/workflows/ci.yml` 使用 **Node 22**。README 记录的验证环境是
  24.22.0，本地用 22 或 24 都可以，但 CI 只跑 22。
- **pnpm**：`packageManager` 固定为 **pnpm@11.13.1**（pnpm 11）。仓库里的
  lockfile 来自上游，安装时加 `--trust-lockfile` 可跳过 pnpm 11 的供应链
  元数据校验（网络条件好时可以省略）。
- **Git submodule**：`vendor/`（iTerm2 色板）用于生成终端主题，克隆时记得
  `--recursive`，否则 `pnpm generate` 会失败。
- Linux + systemd 才能跑真实部署；纯前端改动不需要装 `sing-box-panel`。

```bash
git clone --recursive https://github.com/emoeem/dracpanel.git
cd dracpanel
git submodule update --init --depth 1          # 克隆时忘了 --recursive 才需要

npx --yes pnpm@11.13.1 install --frozen-lockfile --trust-lockfile
npx --yes pnpm@11.13.1 generate                # protobuf + 图标 + 终端主题
npx --yes pnpm@11.13.1 dev
```

`src/gen/` 和 `src/lib/terminalThemes.generated.ts` 是**生成产物，不提交**。
`pnpm build` 之前会由 `prebuild`（`scripts/ensure-generated.mjs`）自动补跑
`pnpm generate`，所以新克隆直接 `pnpm build` 也能过。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | Vite 开发服务器（5173） |
| `pnpm generate` | `buf generate` + 图标 + 终端主题（改 proto 或 submodule 后必跑） |
| `pnpm lint` | ESLint（`src` `scripts` `eslint.config.js` `vite.config.ts`） |
| `pnpm lint:css` | Stylelint（`src/**/*.css`） |
| `pnpm test` | Vitest 单次运行 |
| `pnpm test:coverage` | Vitest + v8 覆盖率 |
| `pnpm build` | `tsc -b` → `vite build` → 生成第三方许可清单 |
| `pnpm preview` | 预览 `dist/` |

CI（`.github/workflows/ci.yml`）在 push/PR 上跑的完整序列：
`pnpm generate` → `pnpm lint` → `pnpm lint:css` → `pnpm test` →
`pnpm build` → `node scripts/smoke-dist.mjs`（校验 dist 引用的资源都存在）→
`node scripts/check-bundle-size.mjs`（体积预算，阈值写在该脚本顶部）→
`shellcheck deploy/*.sh`。本地提交前跑一遍 `pnpm lint && pnpm lint:css &&
pnpm test` 基本就够了。

## 代码风格

### TypeScript / TSX

- ESLint flat config 在 `eslint.config.js`：
  `js.configs.recommended` + `typescript-eslint` recommended +
  `eslint-plugin-react-hooks` flat recommended。
- `src/**/*.{ts,tsx}` 关闭了 `@typescript-eslint/no-unused-vars`、
  `react-hooks/refs`、`react-hooks/set-state-in-effect`，别再依赖这些规则去
  “解释”代码；其余规则照常。
- 类型检查单独跑：`npx tsc --noEmit`（pre-push 钩子会跑）。
- `scripts/**/*.mjs` 也在 lint 范围内，但只声明了 `console` / `URL` /
  `process` 三个全局；脚本只用 Node 内置模块，不要引第三方依赖。

### CSS

- Stylelint 配置在 `stylelint.config.js`：
  `stylelint-config-standard` + `css-modules` + `recess-order`（属性顺序）+ 
  `stylelint-declaration-strict-value`。
- **必须用 `src/styles/` 里的设计 token**，不要写死值：
  - 颜色：`src/styles/globals.css` 的 `--bg` / `--surface` / `--card` /
    `--text` / `--text-secondary` / `--accent` / `--good` / `--bad` /
    `--danger` / `--border` …（暗色在 `[data-theme]` 覆盖里，别写第二套值）。
  - 字号：`--text-2xs` … `--text-3xl`。
  - 字重：`--weight-normal` / `--weight-medium` / `--weight-semibold` /
    `--weight-bold`。
  - 间距：`--space-2` … `--space-64`（`padding` / `margin` / `gap` 都用）。
  - 层级：`--z-sticky-header` / `--z-menu` / `--z-drawer` …
  - 圆角：`--radius-xs` … `--radius-pill`；过渡：`--transition-fast|medium|slow`。
  - 复用的组件外观先找 `src/styles/shared.css`（`.text-title` /
    `.text-metric` / `.card-header` / `.field-label` / `.menu-item` …），
    没有再新增。
  - 暗色不是第二套值：`[data-theme="dark"]` 里只覆盖同一批变量名。
- `scale-unlimited/declaration-strict-value` 明确禁止给 `font-size`、
  `font-weight`、`z-index`、`*gap*`、`padding*`、`margin*` 写字面量，白名单
  只有 `0`、`auto`、`inherit`、`initial`、`unset`、`revert`、`none`、
  `normal`、`max-content`、`min-content`、`fit-content`。
- `color-no-hex` 全局开启（**只能写 token**）；唯一豁免是
  `src/styles/globals.css` —— token 本身必须在这里定义，所以它同时豁免了
  `declaration-strict-value`。改 `globals.css` 之外的地方不要指望豁免。
- CSS Modules 命名用 camelCase（`vite.config.ts` 的 `localsConvention`）。

## 测试

- 框架是 **Vitest**，测试文件与源码同目录：`foo.ts` → `foo.test.ts`
  （组件用 `.test.tsx`）。
- 需要 DOM 的文件在**文件第一行**写：

  ```ts
  // @vitest-environment jsdom
  ```

- jsdom 不做布局也不带 ResizeObserver，用到尺寸/观察器的测试要自己 stub，
  参考 `src/app/useVirtualList.test.tsx`：

  ```ts
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() { return this.dataset?.virtualView === "1" ? VIEWPORT : 0; },
  });
  ```

- 组件/hook 用 `@testing-library/react`（`render` / `renderHook` /
  `screen`），每个用例后 `cleanup()`；`renderHook` 前设
  `globalThis.IS_REACT_ACT_ENVIRONMENT = true`。
- 优先给纯逻辑（`src/lib/*`、`src/api/*` 的解析函数）写用例，视图层只覆盖
  容易回归的交互。
- 覆盖率：`pnpm test:coverage`（`@vitest/coverage-v8`，输出到 `coverage/`）。

## 用户可见文案

所有界面文案都要过 `t()`，并在 **`src/app/translations.ts`** 登记：

- **key 就是英文原文**（`"Manage subscriptions"`），四种语言字段都要给：
  `zh-Hans`、`zh-Hant`、`fa`、`ru`。
- `fa` / `ru` 没有把握时**可以用英文占位**，但不能留空字符串。
- 带变量的文案用 `{name}` 占位，复数用 `PluralForms`；
  翻译里的占位符必须与 key 一致。
- `src/app/i18n.test.ts` 会强制校验：四种语言都不能缺失/为空，且占位符集合
  与 key 相同。**这个测试是硬约束，漏字段会直接红。**
- 未知 key 会原样返回（`t()` 对后端返回的原始错误文本不会破坏可读性），
  所以不要把“看起来像句子”的动态字符串拼进 key。

## 提交与钩子

- Husky（`.husky/`）：
  - **pre-commit** → `npx lint-staged`：`*.{ts,tsx}` 跑
    `eslint --fix --max-warnings=0`，`*.css` 跑 `stylelint --fix`。
  - **pre-push** → `npx tsc --noEmit` + `npx vitest run`。
- 也就是说：**警告也算错**（`--max-warnings=0`），push 前整仓要能编译并通过
  全部测试。装钩子：`pnpm install` 会跑 `prepare`（`husky`）。
- 提交信息沿用仓库现有风格：`feat(scope): ...` / `fix: ...` / `docs: ...`；
  管理模块用 `feat(panel/...)`。
- 不要提交 `dist/`、`src/gen/`、`src/lib/terminalThemes.generated.ts`、
  `coverage/`（已在 `.gitignore` 里）。
- 截图/验收记录放 `artifacts/`，**发布前必须脱敏**（真实目标、节点名、应用
  名、本机路径）。

## 打包发布

Arch 打包文件（`PKGBUILD` / `.SRCINFO`）**不在本仓库内**，单独维护在
`../pkgbuild-source/packages/dracpanel`。发布顺序固定如下，不要跳步：

1. **先提交源码**：确认 `git status` 干净、CI 全绿，再 push。版本号在
   `package.json`（`VITE_APP_VERSION` 会烘进产物，UI 设置页会显示）。
2. **重新构建 dist**：不要复用旧产物。

   ```bash
   pnpm install --frozen-lockfile
   pnpm generate
   pnpm build          # tsc -b → vite build → dist/licenses/THIRD-PARTY.md
   node scripts/smoke-dist.mjs
   ```

3. **生成源码 + dist 的 tarball**（打包源要带构建产物，因为包里不再跑
   Node 构建）：

   ```bash
   ver=$(node -p "require('./package.json').version")
   rm -rf build/pkg && mkdir -p "build/pkg/dracpanel-$ver"
   git archive HEAD | tar -x -C "build/pkg/dracpanel-$ver"
   cp -a dist "build/pkg/dracpanel-$ver/dist"
   tar -czf "dracpanel-$ver.tar.gz" -C build/pkg "dracpanel-$ver"
   sha256sum "dracpanel-$ver.tar.gz"
   ```

   注意 `git archive` 不含未提交的文件，所以第 1 步必须先做完。

4. **更新打包文件**（在 `../pkgbuild-source/packages/dracpanel`）：
   `pkgver` 跟 `package.json` 对齐，`pkgrel` 每次重新打包 +1，替换
   `sha256sums` 为上一步的输出，然后重建 `.SRCINFO`：

   ```bash
   makepkg --printsrcinfo > .SRCINFO
   ```

5. **本地构建验证**：

   ```bash
   makepkg -sf          # 或 makepkg -si 顺带安装
   pacman -Qkk <pkgname>
   ```

6. 装到真实机器上时用 `sudo ./deploy/install.sh --ui-only` 只更新 UI，
   或完整 `install.sh` 走配置 + UI + GeoIP；回滚步骤见
   [DEPLOYMENT.md](DEPLOYMENT.md#rollback)。

## 许可证

改动即视为同意以 **GPL-3.0-or-later** 授权（同上游）。新增第三方依赖时，
`pnpm build` 会自动把生产依赖的许可重新收集到
`dist/licenses/THIRD-PARTY.md`（脚本：`scripts/gen-licenses.mjs`），
不需要手工维护；但**新增非 npm 的素材**（字体、图标、数据集）必须同步更新
`NOTICE` 和 README 的“许可证与致谢”。
