# TPCowork 内网原地增量更新 Spec

> 状态：Proposed
> 目标版本：下一个桌面正式版本
> 第一阶段范围：Windows x64、NSIS、内网 HTTP/HTTPS 静态更新源
> 后续范围：macOS arm64/x64
> 最后更新：2026-08-27

## 1. 文档目的

本文定义 TPCowork 桌面应用在全内网环境中的原地增量更新方案。

目标体验是：用户在应用内点击“下载并更新”，客户端从内网更新源下载新版本；下载完成后，用户确认重启，应用停止本地 nanobot gateway，覆盖现有安装并自动重新启动。整个过程不要求用户进入系统设置卸载旧版本，也不删除用户配置、会话、项目或安装身份。

本方案使用 `electron-builder + electron-updater` 的标准更新协议，不自研二进制补丁器。内网 Nginx 只承担静态文件分发，不需要数据库或更新业务服务。

## 2. 问题定义

当前更新能力只能检查一个远程 `version.json`：

```text
Renderer
  └─ GET version.json
       ├─ 比较版本号
       └─ 返回安装包下载地址
```

当前链路存在以下问题：

1. 更新检查发生在 renderer，Electron 主进程没有更新生命周期权威。
2. 更新地址仍是占位域名，不能用于内网部署。
3. 只能提示下载，不能在应用内下载、显示进度或重启安装。
4. Windows NSIS 配置显式关闭了 `differentialPackage`，构建结果没有 `.blockmap`。
5. 用户需要手工运行安装包，体验接近重新安装。
6. 当前安装包包含内置 Python runtime，完整包体积较大；仅修改 GUI 时仍下载完整包不合理。
7. 缺少签名校验、失败回退、发布原子性、更新日志和真实升级测试。

当前构建基线：

- Windows 使用 NSIS。
- macOS 使用 ZIP。
- 应用 `appId` 为 `com.tparuyi.app`。
- Python runtime 通过 `extraResources` 打入应用。
- electron-builder 已能生成 `latest.yml`，但当前没有 blockmap。

## 3. 术语

- **原地更新**：新版本覆盖现有应用安装，不先执行用户可见的卸载流程。
- **差分下载**：根据 blockmap，只从服务器获取与本地旧版本不同的数据块。
- **完整包回退**：差分下载不可用时，自动下载完整安装包完成原地更新。
- **更新源**：所有客户端均可访问的内网 HTTP/HTTPS 静态目录。
- **Feed**：某个平台、架构和发布通道对应的更新目录及其 URL。
- **发布通道**：例如 `pilot`、`stable`，分别供试点和正式用户使用。
- **更新元数据**：Windows 的 `latest.yml` 或 macOS 的 `latest-mac.yml`。
- **版本化产物**：文件名包含版本和架构、发布后不得覆盖的安装包与 blockmap。

## 4. 目标与非目标

### 4.1 目标

1. 用户不卸载旧版本即可完成更新。
2. GUI 代码变化时优先差分下载，失败时可靠回退完整包。
3. 更新下载不阻塞聊天和文件查看。
4. 下载进度、版本、更新日志、错误和重试状态对用户可见。
5. 安装前可靠停止 nanobot gateway，避免 Python 子进程残留或文件占用。
6. 更新不得删除 `userData`、工作空间、项目文件、会话、定时任务和安装身份。
7. 更新检查、下载、校验和安装只由 Electron 主进程执行。
8. 更新源完全运行在内网，不依赖公网 CDN、GitHub Releases 或公网 API。
9. 支持试点通道验证后再向正式通道发布。
10. 发布不完整或网络异常时，已安装版本继续正常运行。

### 4.2 非目标

1. 第一阶段不实现 Linux 自动更新。
2. 第一阶段不把 Python runtime 拆成独立更新产品。
3. 不实现 P2P、局域网客户端互传或自研二进制补丁算法。
4. 不从 SMB/UNC 共享目录直接执行安装程序。
5. 不允许 renderer 下载或执行任意安装文件。
6. 不自动强制重启正在工作的用户应用。
7. 不自动降级到旧版本；回滚通过重新发布更高版本号的修复版本完成。
8. 不把更新服务器做成带数据库的业务系统。

## 5. 核心设计决策

### 5.1 更新权威在 Electron 主进程

更新涉及网络下载、文件写入、代码签名、进程退出和安装程序执行，必须属于 Electron 主进程职责。

Renderer 只负责：

- 发起检查、下载和安装命令。
- 订阅结构化更新状态。
- 展示进度、更新日志、确认和错误。

Renderer 不得接收安装包本地路径，也不得使用 `shell.openPath()` 执行更新包。

### 5.2 使用 electron-updater 标准协议

第一阶段使用：

```text
electron-builder
  └─ NSIS installer + blockmap + latest.yml

electron-updater
  ├─ 读取 latest.yml
  ├─ 比较版本
  ├─ 校验 SHA-512
  ├─ 差分下载
  ├─ 完整包回退
  └─ quitAndInstall
```

不再维护自定义 `version.json` 作为桌面更新事实源。业务页面若需要展示版本信息，必须使用主进程投影的 updater 状态。

### 5.3 第一阶段优先 Windows

Windows 当前已经使用 NSIS，最适合先落地：

- 生成 `.exe`、`.blockmap` 和 `latest.yml`。
- 支持现有自定义安装目录。
- 支持静默覆盖安装。
- 支持 blockmap 差分下载。

macOS 需要同时完成 Developer ID 签名、公证、架构 feed 和 ZIP 更新产物，放到第二阶段。

### 5.4 Nginx 是静态更新源，不是更新业务服务

Nginx 只需要：

- 提供 `GET` / `HEAD`。
- 支持 `Range` 请求和 `206 Partial Content`。
- 不修改安装包字节。
- 对 `latest.yml` 禁止或严格限制缓存。
- 对版本化安装包允许长期缓存。

不需要数据库、用户表、任务队列或动态版本接口。

## 6. 总体架构

```text
内网构建机 / CI
  ├─ npm ci
  ├─ prepare Python runtime
  ├─ electron-vite build
  ├─ electron-builder
  ├─ 签名
  └─ 生成 installer / blockmap / latest.yml
             │
             │ 管理员或 CI 发布
             ▼
内网 Nginx 静态目录
  ├─ pilot/win32-x64/
  └─ stable/win32-x64/
             │ HTTPS / HTTP + Range
             ▼
Electron Main / UpdateService
  ├─ checkForUpdates
  ├─ downloadUpdate
  ├─ 状态事件
  ├─ SHA-512 / 签名校验
  ├─ 停止 nanobot
  └─ quitAndInstall
             │ typed IPC
             ▼
React Renderer
  ├─ 设置页版本区域
  ├─ 右下角更新提示
  ├─ 下载进度
  └─ 重启安装确认
```

## 7. 内网更新目录规范

推荐服务器目录：

```text
/srv/tpcowork-updates/
  pilot/
    win32-x64/
      latest.yml
      TPCowork-Setup-0.0.2-x64.exe
      TPCowork-Setup-0.0.2-x64.exe.blockmap
  stable/
    win32-x64/
      latest.yml
      TPCowork-Setup-0.0.1-x64.exe
      TPCowork-Setup-0.0.1-x64.exe.blockmap
      TPCowork-Setup-0.0.2-x64.exe
      TPCowork-Setup-0.0.2-x64.exe.blockmap
```

对应 URL：

```text
https://updates.company.internal/tpcowork/pilot/win32-x64/
https://updates.company.internal/tpcowork/stable/win32-x64/
```

要求：

1. URL 以目录结尾。
2. `latest.yml` 中的文件名必须与服务器真实文件名完全一致。
3. 文件名只使用 ASCII、数字、点和连字符，避免空格编码差异。
4. 至少保留当前正式版本和上一个正式版本的安装产物。
5. 不允许用新字节覆盖同名版本化文件。
6. 发布元数据必须最后上传。

## 8. 更新地址配置

默认 feed 应通过构建配置写入 packaged app 的 `app-update.yml`。不同内网环境需要不同地址时，允许主进程读取企业部署配置进行覆盖。

推荐优先级：

```text
测试命令行或环境变量
  > 企业部署配置
  > 打包内置 app-update.yml
```

建议环境变量：

```text
TPCOWORK_UPDATE_URL=https://updates.company.internal/tpcowork/stable/win32-x64/
TPCOWORK_UPDATE_CHANNEL=stable
```

约束：

- feed URL 只允许 `http:` 或 `https:`。
- renderer 不得传入或覆盖 feed URL。
- 正式环境默认使用 HTTPS 和企业内部 CA。
- 临时 HTTP 部署必须仍启用安装包签名和 SHA-512 校验。
- URL、认证头和服务器响应日志不得泄露凭证。

## 9. 打包配置要求

`package.json` / electron-builder 配置需要满足：

1. `electron-updater` 放入生产 `dependencies`。
2. `nsis.differentialPackage` 设为 `true` 或移除显式关闭项。
3. 配置 `publish.provider = generic` 和内网 feed URL。
4. 固定 Windows artifact name：

```text
TPCowork-Setup-${version}-${arch}.${ext}
```

5. 保持 `appId = com.tparuyi.app`，不得因品牌或版本变化修改。
6. 保持 NSIS GUID、安装目录识别和卸载注册身份稳定。
7. 更新构建不得触发真实卸载分支，必须保留 `.installation-id`。
8. 每次发布必须递增 SemVer，禁止重复使用已发布版本号。
9. `latest.yml`、安装包和 blockmap 必须来自同一次构建。

第一阶段预期产物：

```text
dist/installers/
  TPCowork-Setup-0.0.2-x64.exe
  TPCowork-Setup-0.0.2-x64.exe.blockmap
  latest.yml
```

`win-unpacked/` 只用于本地检查，不上传更新服务器。

## 10. UpdateService

新增 `electron/updateService.ts`，封装 `electron-updater`，不得把第三方 updater 实例直接暴露给 IPC。

建议接口：

```ts
interface UpdateService {
  start(): void;
  getState(): DesktopUpdateState;
  check(options?: { manual?: boolean }): Promise<DesktopUpdateState>;
  download(): Promise<DesktopUpdateState>;
  installNow(): Promise<void>;
  installOnQuit(): Promise<DesktopUpdateState>;
  dispose(): void;
}
```

配置：

```text
autoDownload = false
autoInstallOnAppQuit = false（用户选择后再开启）
allowPrerelease = false（stable）
allowDowngrade = false
```

`UpdateService` 只在 packaged app 中连接真实 feed。开发模式使用禁用状态或测试注入的 fake updater，不能误连正式更新源。

## 11. 更新状态机

```text
idle
  └─ check ─────────────► checking
                           ├─ 无新版本 ─► up-to-date
                           ├─ 有新版本 ─► available
                           └─ 失败 ─────► error

available
  └─ download ──────────► downloading
                           ├─ 完成 ─────► downloaded
                           ├─ 取消 ─────► available
                           └─ 失败 ─────► error

downloaded
  ├─ install-on-quit ───► pending-restart
  └─ install-now ───────► installing ─► process exit

error
  └─ retry ─────────────► checking / downloading
```

状态模型：

```ts
type DesktopUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'pending-restart'
  | 'installing'
  | 'error';

interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  publishedAt?: string;
  progress?: {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  checkedAt?: number;
}
```

所有状态转移由主进程串行化。重复点击检查、下载或安装必须幂等，不能启动多个并行 updater 操作。

## 12. IPC 契约

新增 invoke IPC：

```text
updates:get-state
updates:check
updates:download
updates:install-now
updates:install-on-quit
```

新增主进程到 renderer 事件：

```text
updates:state-changed
```

要求：

- preload 暴露类型化 bridge。
- renderer 启动后先读取一次完整状态，再订阅变化。
- 事件 payload 必须可结构化克隆。
- 错误只返回稳定 code 和脱敏 message。
- IPC 不接收安装包 URL、本地路径、命令或任意 feed URL。
- 所有 handler 使用现有安全 IPC 包装模式并记录错误。

## 13. Renderer 交互

### 13.1 启动检查

- packaged app 启动完成后延迟检查，不阻塞首屏和 gateway 启动。
- 自动检查默认每 24 小时最多一次。
- 自动检查失败时不弹阻塞对话框，只记录日志。
- 用户手动点击“检查更新”绕过节流。

### 13.2 设置页

“关于 / 版本更新”区域展示：

- 当前版本。
- 上次检查时间。
- 检查更新按钮。
- 可用版本和更新日志。
- 下载并更新按钮。
- 下载进度。
- 立即重启更新 / 退出时安装。
- 可重试错误。

### 13.3 全局提示

- 发现新版本：右下角非阻塞提示。
- 下载中：设置入口展示进度，不持续刷 toast。
- 下载完成：右下角提示“更新已准备好”。
- 侧栏设置图标可以保留低干扰更新点。

### 13.4 活跃任务

用户选择“立即重启更新”时：

- 如果有正在执行的 Agent、工具或自动化运行，必须显示明确确认。
- 默认建议等待任务结束。
- 不得在没有提示的情况下强制中止正在进行的文件写入。
- “退出时安装”允许用户继续当前工作。

## 14. 安装与退出编排

当前普通退出已经会停止 PythonBridge。更新安装必须复用一个幂等的统一 shutdown 函数，而不是在 `before-quit` 和 updater 中各自维护一套停止逻辑。

推荐流程：

```text
installNow
  ├─ 校验状态必须是 downloaded / pending-restart
  ├─ 标记 isInstallingUpdate = true
  ├─ 禁止创建新的本地执行
  ├─ 销毁 tray
  ├─ 停止 nanobot PythonBridge
  ├─ 停止其他本地主进程服务
  └─ autoUpdater.quitAndInstall(false, true)
```

要求：

1. shutdown 函数可重复调用但只执行一次。
2. PythonBridge 停止有超时和明确日志。
3. 停止失败时默认取消安装退出，不留下半关闭应用。
4. `before-quit` 必须识别 updater 安装退出，避免再次 `preventDefault()` 形成退出循环。
5. 安装完成后自动启动新版本。
6. 更新过程中不得删除应用 `userData`。

## 15. 用户数据与兼容

原地更新必须保持：

```text
%APPDATA%/tpcowork/
  .installation-id
  workspace/
  settings / sessions / schedules / logs
```

要求：

- NSIS 更新不得执行真实卸载清理宏。
- `appId` 和安装 GUID 保持稳定。
- 用户选择的自定义安装目录必须保持不变。
- 新版本数据迁移必须向前兼容，并在失败时保留原始数据。
- 从旧品牌 TPACowork 升级到 TPCowork 的目录迁移继续有效。
- 更新失败或安装未开始时，旧版本仍然可启动。

## 16. Python runtime 策略

第一阶段继续把 Python runtime 放在应用 `extraResources` 中，由桌面应用版本统一更新。

原因：

- 当前 PythonBridge 已按 packaged resources 路径启动 runtime。
- 立即拆分会引入两套版本、两套回滚和兼容矩阵。
- blockmap 可以复用未变化安装包中的大部分数据块。

构建需要尽量确定性：

- 依赖版本固定。
- 文件顺序稳定。
- bytecode 使用稳定的 hash invalidation。
- GUI-only 发布不得无原因重建或改写整个 Python runtime。

只有在实际数据证明 runtime 导致差分包长期接近完整包时，才进入第二阶段：把 runtime 安装到版本化外部目录并进行独立原子更新。

## 17. 发布流程

### 17.1 构建

```text
1. 从干净 checkout 构建。
2. 校验 package.json 版本未发布过。
3. 准备对应平台 Python runtime。
4. 构建 Electron main/preload/renderer。
5. electron-builder 生成签名安装包、blockmap、latest.yml。
6. 在干净虚拟机安装并做启动 smoke test。
```

### 17.2 Pilot 发布

```text
1. 上传版本化 EXE。
2. 上传对应 blockmap。
3. 校验服务器文件大小和 SHA-512。
4. 最后上传 pilot/latest.yml。
5. Pilot 客户端完成升级验证。
```

### 17.3 Stable 发布

```text
1. 将已验证的同一批版本化产物复制到 stable 目录。
2. 再次校验 SHA-512。
3. 最后原子替换 stable/latest.yml。
```

禁止重新构建“相同版本”的 stable 包。Pilot 和 Stable 必须使用完全相同的安装包字节。

## 18. Nginx 要求

Nginx 配置至少满足：

```nginx
location /tpcowork/stable/win32-x64/ {
    alias /srv/tpcowork-updates/stable/win32-x64/;
    autoindex off;
}
```

部署检查：

```text
GET latest.yml                         -> 200
HEAD TPCowork-Setup-...exe            -> 200
GET  TPCowork-Setup-...exe Range: ... -> 206
GET  ...exe.blockmap                  -> 200
```

缓存要求：

- `latest.yml` 使用 `Cache-Control: no-store` 或很短缓存。
- 带版本号的 EXE 和 blockmap 可以长期缓存。
- 代理不得对 EXE 或 blockmap 做 gzip、内容转码或病毒网关字节重写。
- 上传中的临时文件不得使用正式文件名对外可见。

## 19. 安全要求

1. Windows 正式安装包应使用 Authenticode 证书签名。
2. `latest.yml` 的 SHA-512 与实际安装包必须匹配。
3. updater 必须拒绝低于当前版本的版本号。
4. 正式 feed URL 不允许由 renderer 或聊天内容修改。
5. HTTP 只能作为内网过渡方案，推荐企业 CA HTTPS。
6. 更新服务器通过内网 ACL 限制访问，不在客户端嵌入长期管理员凭证。
7. 日志不记录认证头、下载临时文件完整路径或内部秘密。
8. 更新包验签失败、hash 不一致或元数据解析失败时不得执行安装。
9. 代码签名证书和构建签名密钥只存在于受控内网 CI。

## 20. 错误与回退

| 场景 | 行为 |
| --- | --- |
| Nginx 不可达 | 保持当前版本，显示可重试网络错误 |
| `latest.yml` 不存在 | 视为更新源配置或发布错误，不下载任何文件 |
| 元数据指向文件不存在 | 保持当前版本，记录 `artifact_missing` |
| Range 不支持 | updater 回退完整包下载 |
| blockmap 无效 | updater 回退完整包或显示可重试错误 |
| SHA-512 不匹配 | 删除临时下载，禁止安装 |
| 签名无效 | 禁止安装，记录安全错误 |
| 下载中断 | 保持当前版本，允许重试 |
| 磁盘空间不足 | 提示用户释放空间，不退出应用 |
| nanobot 正在执行 | 提示等待或选择退出时安装 |
| nanobot 停止失败 | 取消立即安装，应用保持可恢复状态 |
| 安装启动失败 | 保留已下载状态，允许重试 |
| 新版本启动失败 | 不自动降级；通过更高版本号热修复并保留人工回滚包 |

任何下载失败都不能破坏当前安装。只有安装包完整下载、hash 和签名校验通过后，才允许进入安装阶段。

## 21. 日志与诊断

主进程日志记录：

- 当前版本、平台、架构、通道。
- 检查开始、结束和耗时。
- 是否发现新版本。
- 差分下载或完整包回退。
- 下载字节、总字节、耗时，不逐进度点刷日志。
- hash / 签名校验结果。
- shutdown 每个阶段。
- `quitAndInstall` 调用结果。
- 稳定错误 code。

推荐错误 code：

```text
update_feed_unreachable
update_manifest_invalid
update_artifact_missing
update_download_failed
update_integrity_failed
update_signature_invalid
update_disk_full
update_shutdown_failed
update_install_failed
```

诊断页面可以展示脱敏后的 feed origin、通道、最后检查时间、最后错误和已下载版本，不展示认证信息。

## 22. 测试要求

### 22.1 单元测试

- updater 事件正确映射到 `DesktopUpdateState`。
- 重复检查和下载不会并发执行。
- 手动检查绕过自动检查节流。
- renderer 不能设置 feed URL。
- 非 packaged app 不连接正式 feed。
- error payload 脱敏。
- installNow 只允许从已下载状态执行。
- shutdown 幂等且先停止 PythonBridge 再调用安装。
- updater 安装退出不会被普通 `before-quit` 再次拦截。

### 22.2 IPC 测试

- preload 只暴露约定的更新方法。
- 主进程状态能在 renderer 启动后重放。
- 进度事件可结构化克隆。
- 未授权参数被拒绝。

### 22.3 打包测试

- 生产依赖包含 `electron-updater`。
- Windows 配置开启 differential package。
- 构建生成 EXE、blockmap 和 latest.yml。
- `latest.yml` 文件名与磁盘文件一致。
- `latest.yml` SHA-512 与安装包一致。
- `appId` 和 NSIS GUID 未变化。

### 22.4 内网集成测试

使用真实 Nginx 和 Windows 虚拟机至少验证：

1. `0.0.1 -> 0.0.2` GUI-only 更新。
2. Python runtime 未变化时确实发生差分下载。
3. Python runtime 变化时可以更新并启动 gateway。
4. Range 被关闭时完整包回退成功。
5. 自定义安装目录升级后不改变。
6. 更新后用户设置、会话、项目、定时任务和 `.installation-id` 保留。
7. 下载时断网，旧版本继续运行，恢复后可重试。
8. 下载文件被篡改时拒绝安装。
9. 活跃 Agent 任务场景不会被静默强制重启。
10. TPACowork 历史数据迁移与 TPCowork 更新共存。

## 23. 验收标准

第一阶段完成必须同时满足：

1. Windows 用户可以在应用内完成检查、下载和重启安装。
2. 系统“应用和功能”中不需要先卸载旧版本。
3. 构建产物包含有效 `.blockmap`。
4. GUI-only 更新在测试环境中使用差分下载；需要记录实际传输字节作为证据。
5. 差分不可用时完整包回退成功。
6. 更新后的版本号正确，nanobot gateway 能正常启动。
7. 用户数据和自定义安装路径保持不变。
8. 更新下载或安装准备失败时，旧版本保持可用。
9. 发布过程中客户端不会看到缺少安装包的 `latest.yml`。
10. 定向单元测试、IPC 测试、打包测试和真实双版本升级测试全部通过。

差分大小不设绝对承诺，因为 Python runtime 或 Electron 版本变化可能导致大范围数据块变化；但每次发布必须记录完整包大小和实际下载大小，持续评估增量收益。

## 24. 分阶段实施

### 阶段 0：发布基础

- 确认内网 Nginx URL、DNS、访问策略和企业 CA。
- 准备 Windows 代码签名证书。
- 固定 SemVer、artifact name、appId 和通道目录。
- 建立 Pilot Windows 虚拟机。

### 阶段 1：Windows MVP

- 接入 `electron-updater`。
- 新增 UpdateService、IPC、状态和设置页 UI。
- 开启 NSIS blockmap。
- 支持手动检查、下载、进度、立即重启和退出时安装。
- 完成 Nginx 双版本升级测试。

### 阶段 2：Windows 稳定发布

- 启动静默检查和右下角提示。
- 接入内网 CI 发布。
- 增加 Pilot -> Stable 晋级流程。
- 补齐失败统计和诊断。

### 阶段 3：macOS

- 增加 DMG 首次安装产物和 ZIP 更新产物。
- 完成 Developer ID 签名与 notarization。
- 分离 arm64 / x64 feed。
- 验证应用替换、权限和 gateway 启动。

### 阶段 4：按数据决定 runtime 拆分

- 统计至少数次真实发布的差分比例。
- 只有 GUI-only 更新仍接近完整包时，才设计 Python runtime 独立版本目录、兼容矩阵和原子切换。

## 25. 预计代码改动

```text
package.json
  electron-updater dependency
  publish / artifactName / differentialPackage

electron/updateService.ts
  updater 状态机和安装编排

electron/main.ts
  UpdateService 生命周期、IPC、统一 shutdown

electron/preload.ts
  类型化更新 bridge

src/lib/ipc-factory.ts
  renderer 更新客户端

src/core/updates/
  移除 renderer 直接 fetch 的旧 checker，改为 IPC adapter

src/stores/settingsStore.ts 或独立 updateStore
  镜像主进程更新状态

src/components/settings/
  版本、更新日志、进度和安装控制

src/components/common/ToastContainer.tsx
  发现更新和下载完成提示

.github/workflows/ 或内网 CI 配置
  签名构建、产物校验和内网发布
```

优先复用现有设置 store 和 toast 组件；只有更新状态复杂度继续增长时，才拆出独立 `updateStore`。

## 26. 待部署确认项

实施前需要由部署方确认：

1. Windows 客户端是否都能访问同一个内网 HTTP/HTTPS 地址。
2. Nginx 的正式域名、Pilot 和 Stable 路径。
3. 是否已有企业内部 CA 和 Windows 代码签名证书。
4. 更新源是否需要认证；优先使用网段 ACL，避免在客户端内置共享密码。
5. 首版是否允许 HTTP 过渡。
6. 用户点击下载完成后，是默认询问重启，还是默认退出时安装。
7. 活跃 Agent 任务的最长等待策略。
8. 内网发布由人工上传还是 Jenkins/GitLab CI 自动完成。

这些部署参数不改变 UpdateService 的核心状态机和 IPC 契约。
