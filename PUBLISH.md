# 发布 / 上架指南

## 单一源同步（#6）：先 sync，再 pack

**仓库是唯一源**。本地 bundle（`@local/jev-harness`，默认 `../jev-harness`）由脚本从仓库生成，**不要再手工 `cp`**——手工同步正是两棵树长期漂移、版本号各改一份、`cordis.patch.yml` 的 `name` 行残留 `@local/jev-harness` 导致 tarball 无法解析的根因。

```bash
# 同步：把 index.js / skills.js / criteria.js / lib/client.js / locale/* 复制到 bundle，
# 并把 bundle 的 package.json name 设为 @local/jev-harness、cordis.patch.yml 的 name 行改写为本地包名。
# 版本号永远取自仓库 package.json（单一来源）。
node scripts/sync-bundle.mjs            # 或 npm run sync

# 漂移检测：共享文件 hash 比对 + patch name + 版本一致性，不一致即 exit 1。
node scripts/sync-bundle.mjs --check    # 或 npm run check:drift
```

- bundle 目标目录默认 `../jev-harness`，可用环境变量 `JEV_BUNDLE_DIR` 覆盖（CI 即指向临时目录）。
- **为什么不能靠人肉复制**：bundle 需要的不只是复制——`name` 字段与 `cordis.patch.yml` 的 `name` 行必须改写成**本地**包名，版本号必须与仓库一致。这三处正是人最容易忘、忘了我已经踩过坑（v1.5.0 打包 bug）的地方。脚本把它们固化成必然动作，sync 后立刻自检一次。
- CI 已加「Bundle single-source drift check」步骤：sync 到临时目录并立即 drift-check，验证机制本身可用。

**发布流程**：改版本号（只改仓库 `package.json`）→ `node scripts/sync-bundle.mjs`（重新生成 bundle）→ `npm run check:drift`（确认无漂移）→ `npm pack` → Release → 市场 yml 指向新 tarball。

---

## 当前状态（2026-11-19）

| 项目 | 状态 |
| --- | --- |
| npm 包 | ✅ `@zrxparley/dsh-jev-harness@1.6.2` 已发布，`npm view` + 干净目录安装均验证通过 |
| GitHub Release | ✅ 已到 [v1.6.2](https://github.com/zrxparley/dsh-jev-harness/releases/tag/v1.6.2)（含预构建 tarball 资产） |
| DSHmarket PR | ⏳ [awesome-dsh-plugin#16794](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16794) 已开，仅卡仓库年龄门槛（MIN_AGE_DAYS=1，会自动重跑放行） |
| 市场条目 tarball | 指向 v1.6.2；npm 已上线后，tarball 只是「跳过构建审批」的备选路径 |

**发下一版的命令**（token 已在 `~/.npmrc`）：

```bash
# 1) 改版本号（只改这一处发布树；本地 bundle 由 sync 生成，见顶部「单一源同步」）
npm version patch --no-git-tag-version
# 1b) 重新生成本地 bundle 并确认无漂移
node scripts/sync-bundle.mjs && node scripts/sync-bundle.mjs --check
# 2) 发布
npm publish --access public
# 3) 打 tag + Release（带资产，市场 tarball 用得上）
git commit -am "chore: vX.Y.Z" && git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main --tags
npm pack --pack-destination /tmp && gh release create vX.Y.Z /tmp/zrxparley-dsh-jev-harness-X.Y.Z.tgz --notes "…"
# 4) 市场条目 tarball 指到新版本（yml 在 market/data/plugins/ 下）
```

下面的 1–5 步是最初发布的完整流程，留作参考。

---

本目录是一个**可发布**的 DSH 插件仓库骨架：`@zrxparley/dsh-jev-harness`。
与之前的本地 `@local/jev-harness`（符号链接、只能本机用）不同，这个包可以发布到 npm，
并向 DSHmarket 的精选仓库提交条目，让所有 DSH 用户通过 `dsh plugin add @zrxparley/dsh-jev-harness` 安装。

## 发布步骤（按顺序）

### 1. 生成市场图标（raster PNG）
DSHmarket 条目里的 `icon` 必须是 GitHub 托管的位图（png/jpg/webp，约 96px）。
仓库里已有 `icon.svg`（插件用），另需生成 `docs/icon-96.png`：

```bash
# 用 macOS 自带工具或 Python Pillow 把 icon.svg 渲染成 96x96 PNG
python3 - <<'PY'
from PIL import Image, ImageDraw
im = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
# 两条渐变近似色块 + 箭头，风格与 icon.svg 一致
d.rounded_rectangle([12, 42, 44, 74], radius=7, fill=(79, 110, 247, 255))
d.rounded_rectangle([52, 26, 84, 74], radius=7, fill=(138, 92, 246, 200))
im.save('docs/icon-96.png')
PY
```

### 2. 初始化 Git 仓库并推送
```bash
cd dsh-jev-harness
git init
git add -A
git commit -m "feat: JEV tiered harness plugin for DSH"
gh repo create zrxparley/dsh-jev-harness --public --source=. --remote=origin --push
```

> 注意：awesome-dsh-plugin 要求仓库**创建满 1 天**后才接受收录，所以推送后需等待约 24h 再提 PR。
> 同时给仓库加上 `dsh-plugin` topic：
> ```bash
> gh repo edit zrxparley/dsh-jev-harness --add-topic dsh-plugin
> ```

### 3. 预构建产物（已完成 ✅）
本插件采用 **GitHub Release tarball** 路径，无需 npm 账号也能让用户跳过构建授权：

- Release: https://github.com/zrxparley/dsh-jev-harness/releases/tag/v1.0.0
- 资产: `zrxparley-dsh-jev-harness-1.0.0.tgz`（`npm pack` 生成，12 个文件齐全）
- 市场条目已写入 `tarball:` 字段指向该 URL

如日后想额外发 npm 包（可选，非必需）：
```bash
npm login && npm publish --access public
```
发了以后可在本仓库 `package.json` 保留 npm 名，两种安装方式并存。

### 4. 提交 DSHmarket 条目
向 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 提一个 PR：
- 新增文件：`data/plugins/zrxparley__dsh-jev-harness.yml`（内容就是本仓库 `market/data/plugins/` 下那个文件）
- 一个 PR 最多 3 个条目；本插件只需 1 个
- CI 会校验：仓库声明了 `dsh.bundle`（本包 `package.json` 已声明 ✓）、仓库 ≥1 天、topic 含 `dsh-plugin`、描述与代码相符

### 4.5 实际进度（无需再做）
- ✅ GitHub 仓库已建、已推、已加 `dsh-plugin` topic
- ✅ 预构建 tarball 已挂到 Release v1.0.0，raw 图标/详情/manifest URL 均 HTTP 200
- ✅ 市场条目 yml 已写好（含 `tarball:` 字段）
- ✅ 已向 awesome-dsh-plugin 提交 PR：**https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16794**
- ⏳ 唯一剩余：仓库年龄门槛 —— 创建于 2026-11-19T03:10:58Z，需满 24h（约 2026-11-20T03:11Z 后）。该检查会**自动重跑并转绿**，无需重新提交、无需推送、无需关重开 PR。

### 5. 验证
PR 合并后，在 DSH 里：
```bash
dsh plugin add @zrxparley/dsh-jev-harness
```
设置里填好 base URL 与真实 model id，配好 `*_API_KEY` 环境变量，调用 `harness_probe` 确认网关可达。

## 文件清单
- `index.js` — 4 个工具的运行时（无需改动，已在本地插件上验证通过）
- `cordis.patch.yml` — 插件配置注入
- `locale/en.json` / `locale/zh.json` — 市场元数据（含 detail）
- `docs/DETAIL.md` / `docs/preview.svg` — 详情页（ DETAIL.md 只含一行图片）
- `docs/icon-96.png` — 市场条目图标（步骤 1 生成）
- `icon.svg` — 插件本体图标
- `market/data/plugins/zrxparley__dsh-jev-harness.yml` — 待提交到 DSHmarket 的条目
- `README.md` / `README.zh.md` / `LICENSE` — 文档与许可证

## v1.4.0 发布记录（2026-11-19）

| 项 | 状态 |
| --- | --- |
| GitHub 仓库 main | 已推送 `af09a20`（v1.4.0） |
| Git tag | `v1.4.0` |
| GitHub Release | https://github.com/zrxparley/dsh-jev-harness/releases/tag/v1.4.0 |
| 预构建 tarball | `zrxparley-dsh-jev-harness-1.4.0.tgz`（23,494 B，13 文件），HTTP 200 |
| DSHmarket 条目（本仓库副本） | tarball 已指向 v1.4.0 |
| 市场 PR #16794 | 分支 `add-dsh-jev-harness` 已更新到 v1.4.0 条目 |
| npm 发布 | **未完成 — 无凭据**（`npm whoami` → ENEEDAUTH；`~/.npmrc` 只有 registry 与 prefix，无 `_authToken`） |

npm 解锁方式（任选其一，需要你本人的账号动作）：

```bash
npm login                 # 浏览器授权，之后 npm publish 即可
# 或
npm config set //registry.npmjs.org/:_authToken=<你的 npm token>
```
