# 测试

离线回归套件。零运行时依赖：只用 `node:test` + `node:assert`，网络全部 stub。

## 怎么跑

```bash
npm run check   # node --check index.js && node --check lib/client.js
npm test        # node --test "test/**/*.test.js"
```

本机没有 npm 时，用裸 node（路径按你的安装调整）：

```bash
node --check index.js && node --check lib/client.js
node --test "test/**/*.test.js"
```

> 注意：Node 24 不再把目录参数展开成测试文件，`node --test test/` 会去 require 一个名叫 `test` 的模块然后报
> `Cannot find module .../test`。用上面的 glob 写法，Node 22 和 24 都成立。

## 目录

```
test/
  fixtures/                 固定输入（store、流量看板、技能 tarball 清单）
  helpers/harness.js        临时 DSH_HOME、假 ctx、假 req/res、fetch stub
  helpers/client.js         用 vm 装载 lib/client.js，从 profile 解析 react
  helpers/tar.js            极简 ustar/gzip 构造器（给技能刷新用）
  client-slots.test.js      7 个 slot 注册（含 register 第二参数）
  panel-render.test.js      主面板真渲染：总开关 / 流量看板 / 技能库 / 39 个技能
  traffic-board.test.js     流量看板 24 小时与 7 天两种粒度
  bridge-routes.test.js     status / save / toggle / stats / test 五条设置桥路由
  bundle-id.test.js         客户端 bundle id 与宿主 manifest 的契约（#27）
  release-pack.test.js      按 files 打包/解包后的客户端挂载 smoke（#27）
  usage-hour.test.js        记账与 /stats 小时粒度
  usage-day.test.js         7 天视图读日汇总（v1.6.0 事故回归）
  usage-integrity.test.js   账本损坏隔离 / 原子写 / 只读盘 / 并发记账（#25 回归）
  panel-warning.test.js     账本损坏时面板上的可见提示
  skills.test.js            技能目录 / 刷新 / JEV pick
  skills-guard.test.js      坏 tar / 空 tar / 缺字段 / 数量腰斩 / 原子替换（#28）
  helpers/record-child.js   并发用例的子进程：往同一个 DSH_HOME 连记 N 次
```

## 三条硬规则

1. **失败必须让进程非 0 退出。** 全部用 `node:assert`，不写 `allOk && exit 0` 这种假绿。
2. **不碰真实 `~/.dsh`。** 每个用例 `mkdtemp` 一份临时 `DSH_HOME`，跑完删掉；测试里没有写死的绝对路径。
3. **不发真实网络请求。** `helpers/harness.js` 的 `stubFetch` 命中不到就抛错，所以漏 stub 会直接变红。
   react 从本机 DSH desktop profile 解析；CI 里由 `devDependencies` 提供。
   **解析不到时渲染用例默认让文件失败**，不允许静默 skip（否则缺依赖会伪装成全绿）。
   确实没有 react 的环境（离线手工排查）要显式 `JEV_ALLOW_NO_REACT=1`，此时会打印 skip 原因。