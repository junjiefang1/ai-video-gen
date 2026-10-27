# AI Video Studio (ai-video-gen)

AI 视频生成 Web 工具：基于阿里云百炼 DashScope 视频生成模型（HappyHorse t2v / r2v / video-edit）与 Qwen（qwen-plus / qwen-vl-plus）的 prompt 改写与分镜拆解，浏览器端使用 ffmpeg.wasm 完成长视频拼接。

## 功能

- 文生视频：文本描述 → 视频（480p/720p/1080p，2–10 秒）
- 图生视频：首帧图片 + 运动描述 → 视频
- 视频编辑：源视频 + 编辑指令（可选参考图）
- 批量模式：多条 prompt 批量提交，并发控制、自动重试、降级策略、CSV 导入导出
- 长视频生成：总描述 → AI 拆分镜 → 逐段生成 → ffmpeg.wasm 拼接（支持主角图一致性）

## 技术栈

React 18 + TypeScript + Vite 6 + Tailwind CSS 3 + ffmpeg.wasm

## 快速开始

```bash
npm install

# 复制 ffmpeg.wasm 核心文件（必须，仓库内不含二进制）
# 从 node_modules/@ffmpeg/core/dist/umd/ 复制到 public/ffmpeg/：
#   ffmpeg-core.js, ffmpeg-core.wasm

npm run dev
```

打开浏览器后在弹窗中输入自己的 DashScope API Key（存于 localStorage，key: `dashscope_api_key`，每个用户各自输入、天然多用户）。

## 配置分离说明

- API Key：用户侧 localStorage，不入代码、不入仓库
- 模型名 / 代理：`vite.config.ts`（开发）与 `deploy/nginx.conf`（生产）
- 国际站 / 国内站切换：proxy target 在 `dashscope-intl.aliyuncs.com` 与 `dashscope.aliyuncs.com` 之间切换
- 部署参数：`deploy/` 目录（setup-server.sh / deploy.sh / nginx.conf）

## 生产部署

见 `deploy/`：`setup-server.sh` 初始化 ECS（nginx + 目录），`deploy.sh` 发布 dist 到 `/var/www/ai-video-gen`；外网访问经 Cloudflare Tunnel。nginx 必须带 COOP/COEP 头（ffmpeg.wasm 依赖 SharedArrayBuffer）与 `/dashscope/` 反向代理。

## CI

GitHub Actions（`.github/workflows/ci.yml`）：push / PR 到 main 时执行 `npm ci` + `npm run build`（含 tsc 类型检查），并上传 dist 产物。

## 已知坑点（实际踩过）

1. ffmpeg.wasm 加载挂死：vite `optimizeDeps.exclude` + `toBlobURL()` 预加载 + COEP 用 `credentialless` + 30 秒超时
2. DashScope `resolution` 参数必须大写（"720P"）
3. 主角图优先级：`protagonist ? protagonist.dataUrl : seg.imageUrl`
4. 图片存 Blob URL，仅提交 API 时临时转 base64
5. Vite proxy rewrite 需去掉 `/dashscope` 前缀
6. ffmpeg-core 文件需手动复制到 `public/ffmpeg/`
7. 分镜拆解 imageIndex 为 1-based，代码转 0-based
