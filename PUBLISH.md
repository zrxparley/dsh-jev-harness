# 发布 / 上架指南

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

### 3. 发布 npm 包
```bash
npm publish --access public   # 先 npm login
```
发布预构建产物可让用户安装时**跳过构建授权**（推荐）。

### 4. 提交 DSHmarket 条目
向 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 提一个 PR：
- 新增文件：`data/plugins/zrxparley__dsh-jev-harness.yml`（内容就是本仓库 `market/data/plugins/` 下那个文件）
- 一个 PR 最多 3 个条目；本插件只需 1 个
- CI 会校验：仓库声明了 `dsh.bundle`（本包 `package.json` 已声明 ✓）、仓库 ≥1 天、topic 含 `dsh-plugin`、描述与代码相符

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
