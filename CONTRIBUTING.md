# 贡献指南

本仓库使用标准的 Git 分支 + Pull Request + CI 工作流。

## 分支模型

- `main`：受保护分支，始终保持可构建、可部署。所有改动经 PR 合并进来。
- `feat/*`、`fix/*`、`docs/*`、`chore/*`：从 `main` 切出的短生命周期工作分支，命名体现意图，例如
  - `feat/batch-concurrency`
  - `fix/ffmpeg-load-timeout`
  - `docs/add-contributing-guide`

## 提交流程

1. 从最新的 `main` 切出工作分支：

   ```bash
   git checkout main && git pull
   git checkout -b feat/your-change
   ```

2. 小步提交，遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
   `feat:` / `fix:` / `docs:` / `chore:` / `refactor:` 等前缀。

3. 推送分支并开 PR：

   ```bash
   git push -u origin feat/your-change
   ```

   在 GitHub 上创建 Pull Request，填写改动说明与验证方式。

4. 等待 CI 通过后由 reviewer 合并（默认 Squash merge，保持 `main` 历史线性）。

## CI

`.github/workflows/ci.yml` 会在每次 `push` 到 `main` 以及每个针对 `main` 的 `pull_request` 上触发：

- `npm ci`：按 `package-lock.json` 干净安装依赖
- `npm run build`：即 `tsc -b && vite build`，同时完成类型检查与生产构建
- 上传 `dist` 构建产物（保留 7 天）

CI 未通过的 PR 不应合并。

## 约定

- 禁止提交任何密钥（AccessKey、`.env`、`*.pem`、`*.key` 等）；`.gitignore` 已覆盖，PR 前请自查 `git diff --cached`。
- `public/ffmpeg/` 下的 `ffmpeg-core.js` / `ffmpeg-core.wasm` 为从 `@ffmpeg/core` 复制的二进制产物，不入库；见 README「快速开始」的重建步骤。
- API Key 仅存于浏览器 `localStorage`（key `dashscope_api_key`），不写入代码或仓库。
