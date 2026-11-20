# 宿主需求：让插件路由可以选择加入 DSH 的浏览器鉴权

> 状态：**提案**。本文是 issue #26 的配套证据，不是对本仓库的待办。
> 结论先说：**在插件这一层无法根治 #26**，需要 DSH 暴露一个「页面可读、本机进程读不到」的凭证通道。

## 一、实测差异

同一个监听端口、同一时刻，两条 curl：

```console
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:58935/
401

$ curl -s http://127.0.0.1:58935/api/jev-harness/status -H 'sec-fetch-site: same-origin' | head -c 80
{"ok":true,"enabled":true,"file":"…","gateways":{…}}     # 200，全量
```

- 根路径：`401 dsh web authentication required; reopen the URL printed by dsh web.`
- 插件用 `webServer.register({ kind, path, handler })` 注册的 `/api/*` 路由：**完全不经过鉴权**。

也就是说：宿主已经有可靠的浏览器鉴权，但插件路由默认挂在它外面。

## 二、宿主现成的鉴权实现（来自 `app.asar` 内 `@deepseek-ai/dsh-client-connection`）

| 机制 | 位置/形态 |
|---|---|
| 启动令牌换 cookie | 打开 `dsh web` 打印的 URL（带 `launchToken`）时 `302`，`set-cookie` 下发签名 cookie |
| cookie 名 | `dsh-auth-` + `base64url(sha256(authority))` |
| cookie 属性 | `HttpOnly; SameSite=Strict; Path=/; Max-Age=…`（TLS 时加 `Secure`） |
| 签名 | `v2.<base64url(payload)>.<HMAC-SHA256(secret)>`，`secret` 每次激活生成 |
| 校验入口 | `isAuthenticated(request, secure)`、`authenticateApi(request, secure)`、`writeUnauthorized(req, res)` |
| 失败响应 | `401`，正文即上面那句英文 |

对插件来说，缺的不是「有没有鉴权」，而是「**能不能调用这套鉴权**」：`secret` 只在宿主内存里，插件拿不到；`isAuthenticated` / `authenticateApi` 也没有作为 Cordis 服务暴露（`ctx.get(...)` 取不到）。

## 三、插件侧已经做到哪一步（证据）

`index.js` 目前实现了：

1. 每次进程启动生成 64 位 hex 的 `BRIDGE_TOKEN`，仅内存；
2. 独立 bootstrap 路由 `GET /api/jev-harness/token` 下发；
3. 其余 8 条路由要求 `Authorization: Bearer <token>`，缺失/错误 → `401`，token 不进 URL、不落盘、不进 `/status`；
4. Origin / `Sec-Fetch-Site` 闸保留作纵深防御。

局限（Verifier 实测，复验单 `R1-26-bridge-origin-20261119.md`）：

```
GET  /token  (无 Origin + 伪造 Sec-Fetch-Site: same-origin) → 200，拿到 token
GET  /status (带该 token)                                    → 200，全量
POST /save   (带该 token + 匹配 Origin)                      → 200，改写 baseURL
```

**bootstrap 只要能被伪造请求头拿到，token 就等于公开。** 任何 HTTP 下发、且下发口只靠可伪造请求头的凭证，对本机进程都不构成边界。

## 四、建议的最小接口（二选一即可）

### 方案 A（推荐）：路由级开关

```ts
// 现状
webServer.register({ kind: 'exact', path: '/api/jev-harness/status', handler })

// 建议：允许声明需要浏览器鉴权
webServer.register({ kind: 'exact', path: '/api/jev-harness/status', handler, auth: 'browser' })
```

宿主在调用 `handler` 前用现成的 `isAuthenticated(req, secure)` 校验；不通过就复用它自己的 `writeUnauthorized`。插件不需要知道 `secret`，也不用自己设 cookie。

### 方案 B：把校验器暴露成服务

```ts
const auth = ctx.get('webAuth')            // 或 clientConnection 上的方法
auth.isAuthenticated(req)                  // 插件在自己的 handler 里调用
```

插件拿到 `true` 才继续；语义与宿主一致，但每个插件都要自己写一遍 401。

## 五、为什么这对本仓库是阻断项

- #26 的原威胁是「本地任意进程改写 baseURL 与密钥」。只要 bootstrap 对伪造头开放，这个威胁就成立；
- DSH 的 `secret` 不进插件进程，插件无法自证 cookie 真伪；token 只能抬高「随手脚本」的门槛；
- 方案 A 的改动面在宿主的一处路由分发，插件侧只需加一个布尔字段。

## 六、影响

- 不修：插件设置桥（`/api/jev-harness/*`）对同 UID 本地进程始终可写；密钥/store 的最终边界仍是文件权限（另见 #9）。
- 修了：设置桥第一次拥有与 DSH 页面同级的鉴权，`jev-harness.json` 的写入才能只由页面发起。