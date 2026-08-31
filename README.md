# pure-readest

> [!IMPORTANT]
> **非官方分支声明 / Unofficial fork**
>
> 本仓库（`pure-readest`）是开源项目 [Readest](https://github.com/readest/readest)（AGPL-3.0）的**非官方第三方分支**，与 Readest 官方项目及其所属公司 Bilingify LLC **没有任何隶属、合作或认可关系**，也不受官方支持。`Readest` 名称、图标等商标归其权利所有者所有，本分支仅在标识兼容性时引用。
>
> 本分支在保留上游功能的基础上进行了定制与修改，并持续跟踪上游更新；所有改动仍遵循上游的 [AGPL-3.0](./LICENSE) 许可协议。需要原版完整功能、官方安装包与文档、以及官方支持，请访问 [readest.com](https://readest.com) 或 [github.com/readest/readest](https://github.com/readest/readest)。
>
> **English:** This repository (`pure-readest`) is an **unofficial third-party fork** of [Readest](https://github.com/readest/readest) (AGPL-3.0). It is not affiliated with, endorsed by, or supported by the Readest project or Bilingify LLC. All modifications are licensed under [AGPL-3.0](./LICENSE). For the official app, downloads, documentation, and support, see [readest.com](https://readest.com) or [github.com/readest/readest](https://github.com/readest/readest).

---

## 简介 / About

`pure-readest` 是面向 **Windows 桌面**的 Readest 分支：

- 移除了官方 Readest 账号登录与 Readest Cloud 云同步（不会出现登录/注册界面，也不会向官方服务器上传数据）；
- 保留并可直接使用 WebDAV、Google Drive、S3、OneDrive、iCloud 等第三方文件同步；
- DeepL、Yandex 等翻译功能不再依赖官方登录/订阅，改为构建时配置自有密钥即可使用；
- GitHub Actions 在推送时自动构建 Windows 安装包（NSIS）并发布 Release。

阅读功能与上游保持一致：EPUB、PDF、MOBI、AZW3、FB2、CBZ、TXT、MD 等多种格式，滚动/翻页阅读、批注高亮、全文搜索、词典/Wikipedia 查词、DeepL/Yandex 翻译、TTS 朗读、并排阅读、OPDS/Calibre 集成、KOReader 进度/笔记同步等。

---

## 与官方版的区别 / Differences from upstream

### 1. 已移除：官方账号与 Readest Cloud

以下上游功能在本分支中**整体移除**：

- Readest 账号的登录、注册、找回密码页面及鉴权逻辑；
- Readest Cloud 云同步（书库、阅读进度、笔记、书签、阅读统计归档、副本/设置同步）；
- 官方云端配套功能：分享链接、Send to Readest 收件箱、云端存储/配额管理、用户中心、使用量统计；
- 官方更新检查页面与云端更新通道；
- 官方后端所需的 Docker、Supabase、数据库迁移、统计归档等全部服务端组件。

**效果：** 应用内不会出现任何登录/注册入口；不会向 `readest.com` 或官方后端上传任何数据。需要云同步时，由你自选的第三方服务（WebDAV / Google Drive / S3 / OneDrive / iCloud）承担，数据直接在这些服务与你设备之间传输。

### 2. 已修改：功能与配置

- **应用标识：** 应用名与可执行文件名改为 `pure-readest`，版本号独立（当前 `0.0.x`），与上游版本号不再一致。
- **云同步：** `Readest Cloud` 在后端恒为关闭状态，即使导入了来自上游的旧设置也不会被启用；其余第三方同步后端不受影响。
- **翻译：** DeepL / Yandex / Azure 不再要求 Readest 登录。DeepL 需在构建时配置自有密钥（`DEEPL_FREE_API_KEYS` / `DEEPL_PRO_API_KEYS`）；各第三方翻译服务仍需要其自身账号/凭据。
- **Google Drive / OneDrive：** 需要在构建时配置**你自己的 OAuth 客户端 ID**（不使用官方的客户端凭据）。
- **修复（WebDAV 409）：** 兼容坚果云等对“已存在目录再次执行 MKCOL”返回 `409` 而非标准 `405` 的服务器。官方版在该场景下会直接同步失败（“同步失败(错误码409)”），本分支已修复。
- **修复（启动崩溃）：** 恢复了 `tauri.conf.json` 中缺失的 updater 插件配置（此前移除该配置会导致应用启动即崩溃），并改用本分支自己的 minisign 公钥与 Release 端点。

### 3. 构建与发布

| 项目 | 官方 Readest | pure-readest |
| --- | --- | --- |
| 构建平台 | macOS / Windows / Linux / Android / iOS / Web | **仅 Windows 桌面（NSIS 安装包）** |
| 发布渠道 | 官网、App Store、Google Play、Web 等 | 仅 GitHub Releases（`v{版本号}`） |
| 发布方式 | 官方维护 | 推送 `main`/`master` 后由 GitHub Actions 自动构建并创建 Release |
| 自动更新 | 官方更新通道 | 不生成签名更新工件（`createUpdaterArtifacts: false`），需从 Releases 手动下载 |
| 代码签名 | 官方签名 | 未签名 |

版本号取自 `apps/readest-app/package.json`，每次发布为 `v0.0.x`。

### 4. 已知残留（来自上游，不影响功能）

- 关于对话框中仍显示“Source code is available at github.com/readest/readest”及版权方 Bilingify LLC；
- macOS 原生菜单中的部分 `readest.com` 帮助/隐私链接仍存在；
- 上游 PostHog 遥测代码仍然保留：**新用户默认关闭（opt-out）**，可在设置中管理；数据发往上游配置的 PostHog 实例，与官方账号/Readest Cloud 无关。如不需要，可在构建时移除相应环境变量。

---

## 下载与安装 / Downloads

- 前往 [Releases](https://github.com/ZerothRound/pure-readest/releases) 下载最新的 Windows 安装包（NSIS）。
- 安装后如需云同步：进入 **设置 → 同步/集成**，配置 WebDAV、Google Drive、S3、OneDrive 或 iCloud 之一（坚果云等 WebDAV 服务器可直接使用）。
- 首次启动可在设置中确认遥测选项（默认关闭）。

---

## 从源码构建 / Building from source（可选）

> 构建依赖较重（Rust + Node 工具链），**建议直接使用 Release 安装包**。以下仅为有定制需求时参考。

环境要求：Node.js 22、pnpm 11.x、Rust 工具链、各平台 Tauri 构建依赖。

```bash
pnpm install --frozen-lockfile
cd apps/readest-app
pnpm setup-vendors
# 按需配置 .env（DeepL 密钥、Google Drive / OneDrive OAuth 客户端 ID 等）
pnpm tauri build
```

---

## 许可 / License

本项目基于 [AGPL-3.0](./LICENSE) 发布，与上游 Readest 一致。根据该协议，基于本代码的修改与分发仍需保持开源，网络服务场景下还需提供对应服务端源码。

---

## 致谢 / Credits

感谢 [Readest](https://github.com/readest/readest) 项目及其所有作者与贡献者，本分支的所有功能都建立在上游工作之上。
