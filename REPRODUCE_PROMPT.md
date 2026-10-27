# AI Video Studio - 完整复刻 Prompt

将以下 prompt 完整粘贴给 Qoder，即可一键复制此项目。

---

## Prompt 正文（复制下面全部内容）

```
请帮我从零创建一个 AI 视频生成工具 Web 应用（AI Video Studio），基于阿里云百炼 HappyHorse 模型。

## 技术栈

- React 18 + TypeScript + Vite 6
- Tailwind CSS 3 + tailwindcss-animate
- lucide-react 图标库
- class-variance-authority + clsx + tailwind-merge（UI组件工具）
- ffmpeg.wasm（浏览器端视频拼接）
- 不需要路由库（单页Tab切换）

## 功能模块（5个Tab）

1. **文生视频** - 输入文本描述，选分辨率(480p/720p/1080p)和时长(2-10秒)，调用 HappyHorse t2v 模型
2. **图生视频** - 上传首帧图片+运动描述，调用 HappyHorse r2v 模型
3. **视频编辑** - 上传源视频+编辑指令+可选参考图，调用 HappyHorse video-edit 模型
4. **批量模式** - 多条prompt批量提交，支持并发控制、自动重试、降级策略、CSV导入导出
5. **长视频生成** - 输入总描述→AI拆分镜→逐段生成→ffmpeg拼接为完整视频

## API 规范（极其重要，必须严格遵守）

### DashScope 视频生成 API

- 基础路径（开发环境通过 Vite proxy）：`/dashscope`
- 提交任务：`POST /dashscope/api/v1/services/aigc/video-generation/video-synthesis`
- 查询任务：`GET /dashscope/api/v1/tasks/{taskId}`

请求头：
```
Content-Type: application/json
Authorization: Bearer {apiKey}
X-DashScope-Async: enable
```

模型名称（固定写死）：
- 文生视频: `happyhorse-1.0-t2v`
- 图生视频: `happyhorse-1.0-r2v`
- 视频编辑: `happyhorse-1.0-video-edit`

请求体格式（文生视频示例）：
```json
{
  "model": "happyhorse-1.0-t2v",
  "input": { "prompt": "..." },
  "parameters": { "resolution": "720P", "duration": 5 }
}
```

请求体格式（图生视频 r2v）：
```json
{
  "model": "happyhorse-1.0-r2v",
  "input": {
    "prompt": "...",
    "media": [{ "url": "base64或URL" }]
  },
  "parameters": { "resolution": "720P", "duration": 5 }
}
```

注意：resolution 值传给API时必须大写（"720P" 不是 "720p"）。

响应格式：
```json
{ "output": { "task_id": "...", "task_status": "PENDING" } }
```

任务查询响应（成功时）：
```json
{ "output": { "task_status": "SUCCEEDED", "video_url": "..." } }
```

### Qwen API（用于 AI Prompt 改写和分镜拆解）

- 路径：`/dashscope/compatible-mode/v1/chat/completions`
- OpenAI 兼容格式
- 纯文本用 `qwen-plus`，有图片用 `qwen-vl-plus`（视觉模型）
- Authorization: Bearer {同一个 apiKey}

## Vite 配置（关键坑点，必须严格遵守）

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  // 【关键】ffmpeg.wasm 不能被 Vite 预打包，否则 Worker 加载会失败
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    // 【关键】ffmpeg.wasm 需要 SharedArrayBuffer，必须设置这两个头
    // 注意：COEP 必须用 credentialless 而不是 require-corp，否则会阻止外部资源加载
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: {
      '/dashscope': {
        target: 'https://dashscope-intl.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dashscope/, ''),
      },
    },
  },
})
```

## ffmpeg.wasm 集成（关键坑点）

### 安装
```
npm install @ffmpeg/ffmpeg @ffmpeg/util @ffmpeg/core
```

### 静态文件
必须将 ffmpeg-core.js 和 ffmpeg-core.wasm 从 node_modules/@ffmpeg/core/dist/ 复制到 public/ffmpeg/ 目录：
```
public/ffmpeg/ffmpeg-core.js
public/ffmpeg/ffmpeg-core.wasm
```

### 加载代码（video-concat.ts）
```typescript
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null

async function getFFmpeg(onProgress?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance
  
  onProgress?.('正在加载 ffmpeg 引擎...')
  const ffmpeg = new FFmpeg()
  ffmpeg.on('log', ({ message }) => console.log('[ffmpeg]', message))

  // 【关键】使用 toBlobURL 将文件转为 Blob URL
  // 这样 Worker 内部不需要再发起网络请求，完全避免 CORS/COEP 问题
  const baseURL = '/ffmpeg'
  const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript')
  const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')

  // 【关键】带 30 秒超时，防止加载永久挂起
  const loadPromise = ffmpeg.load({ coreURL, wasmURL })
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('ffmpeg 加载超时（30秒），请刷新页面重试')), 30000)
  })
  await Promise.race([loadPromise, timeoutPromise])

  ffmpegInstance = ffmpeg
  return ffmpeg
}
```

拼接逻辑：下载所有视频片段 → 写入虚拟文件系统 → 创建 concat list → `ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4` → 读取输出 → 清理。

## 长视频功能核心逻辑

### 流程
配置(总描述+时长+图片) → AI改写Prompt(可选) → AI拆分镜 → 用户Review/编辑 → 并发生成各段 → ffmpeg拼接 → 预览/下载

### 主角设定（人物一致性）
- 用户可上传一张主角照片
- 设定后，所有分镜强制使用该照片作为参考图（走 r2v 模型），保证人物外形一致
- 优先级规则（极其重要）：`protagonist ? protagonist.dataUrl : seg.imageUrl`
  - 主角图 > 场景绑定图 > 无图（纯文生视频）
  - 即：如果设了主角，所有分镜都用主角图，忽略场景图

### 图片处理
- 图片上传后压缩（最大边1280px，JPEG质量0.7）
- 存储为 Blob URL（不占 JS 堆内存）
- 仅在提交 API 时临时转为 base64 Data URL

### 分镜拆解（prompt-decompose.ts）
- 有图片时用 qwen-vl-plus 视觉模型，能直接"看"到图片内容来分配
- AI 返回 JSON 数组 [{index, prompt, imageIndex?}]
- imageIndex 用于自动绑定图片池中的对应图片到分镜

### AI Prompt 改写（prompt-rewrite.ts）
- 采用 few-shot 教学 + response_format: json_object
- 5 种 context 对应不同的改写策略（text-to-video, image-to-video, video-edit, long-video, batch）
- 输出格式：{rewritten: "结构化描述", highlights: ["亮点1", "亮点2"]}
- 有图片时不使用 few-shot（视觉模型对多模态 few-shot 支持有限）

## UI 设计规范

- 暗色主题为默认（html class="dark"）
- 紫色主色调：HSL(262, 83%, 62%)
- 渐变按钮：紫色到蓝色 135deg
- 卡片式布局，左侧配置面板(420px)，右侧预览区
- shadcn/ui 风格的 CSS 变量系统（--background, --foreground, --primary 等）
- 自定义工具类：gradient-primary, shadow-glow, text-gradient, border-gradient, upload-zone
- 中文 UI，PingFang SC / Microsoft YaHei 字体栈

## package.json 依赖（确保版本一致）

```json
{
  "dependencies": {
    "@ffmpeg/core": "^0.12.6",
    "@ffmpeg/ffmpeg": "^0.12.10",
    "@ffmpeg/util": "^0.12.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^2.6.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "~5.6.2",
    "vite": "^6.0.5"
  }
}
```

## 文件结构

```
src/
├── main.tsx                      # 入口
├── App.tsx                       # 主应用（Tab切换、API Key管理、任务提交）
├── index.css                     # Tailwind + CSS 变量（深浅主题）
├── lib/
│   ├── api.ts                    # DashScope API 封装（submit + query + model mapping）
│   ├── video-concat.ts           # ffmpeg.wasm 拼接逻辑
│   ├── prompt-rewrite.ts         # Qwen AI 改写（few-shot，5种context）
│   ├── prompt-decompose.ts       # Qwen AI 分镜拆解（支持视觉模型）
│   ├── utils.ts                  # cn() 工具函数
│   ├── batch-types.ts            # 批量模式类型定义
│   ├── batch-parser.ts           # CSV/文件解析
│   ├── batch-cascade.ts          # 降级/重试策略
│   └── batch-storage.ts          # localStorage 持久化
├── hooks/
│   ├── useBatchQueue.ts          # 批量队列 Hook
│   └── useBatchLog.ts            # 批量日志 Hook
├── components/
│   ├── Header.tsx                # 顶部导航
│   ├── TabNav.tsx                # 5个Tab切换
│   ├── TextToVideoPanel.tsx      # 文生视频面板
│   ├── ImageToVideoPanel.tsx     # 图生视频面板
│   ├── VideoEditPanel.tsx        # 视频编辑面板
│   ├── LongVideoPanel.tsx        # 长视频面板（主角设定、图片池、分镜管理）
│   ├── VideoPreview.tsx          # 视频预览区
│   ├── TaskStatusBar.tsx         # 任务状态条
│   ├── PromptRewriteSection.tsx  # 通用AI改写组件
│   ├── ApiKeyModal.tsx           # API Key 弹窗
│   ├── Toast.tsx                 # 提示通知
│   ├── ErrorBoundary.tsx         # 错误边界
│   ├── ui/button.tsx             # Button 组件（含 gradient variant）
│   ├── ui/card.tsx               # Card 组件
│   └── batch/                    # 批量模式子组件
│       ├── BatchPanel.tsx
│       ├── BatchDashboard.tsx
│       ├── BatchControls.tsx
│       ├── BatchTaskList.tsx
│       ├── BatchTaskRow.tsx
│       ├── BatchProgressBar.tsx
│       ├── BatchLogTimeline.tsx
│       ├── BatchExportButton.tsx
│       ├── BatchInputSection.tsx
│       ├── BatchSettingsPanel.tsx
│       ├── MultiPromptInput.tsx
│       ├── TemplateInput.tsx
│       └── FileUploadInput.tsx
public/
├── ffmpeg/
│   ├── ffmpeg-core.js            # 从 @ffmpeg/core 复制
│   └── ffmpeg-core.wasm          # 从 @ffmpeg/core 复制
└── images/                       # 背景图等静态资源
```

## 必须避免的坑（全部是实际踩过的）

1. **ffmpeg.wasm 加载挂死**：
   - 必须在 vite.config.ts 中 `optimizeDeps.exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']`
   - 必须使用 `toBlobURL()` 预加载核心文件为 Blob URL
   - COEP 头必须是 `credentialless` 而不是 `require-corp`
   - 加载必须有超时机制（30秒）

2. **API resolution 参数大写**：传给 DashScope 时必须 `.toUpperCase()`，即 "720P" 而非 "720p"

3. **主角图优先级**：必须是 `protagonist ? protagonist.dataUrl : seg.imageUrl`，不能是 `seg.imageUrl || protagonist`（否则场景图会覆盖主角图）

4. **图片存储为 Blob URL**：用 `URL.createObjectURL(blob)` 存储，不要直接存 base64 字符串在 state 里（内存爆炸）。仅在调 API 时临时 fetch → readAsDataURL 转 base64。

5. **Vite proxy rewrite**：`/dashscope` 代理到 `https://dashscope-intl.aliyuncs.com`，rewrite 要去掉 `/dashscope` 前缀。

6. **ffmpeg-core 文件必须手动复制到 public/ffmpeg/**：不会自动从 node_modules 复制，build 后也需要在 dist/ffmpeg/ 目录有这两个文件。

7. **长视频分镜拆解的 imageIndex**：AI 返回的是 1-based，代码中要转为 0-based（`s.imageIndex - 1`）。

## 生产部署

### nginx 配置要点
```nginx
server {
    listen 80;
    server_name _;
    root /var/www/ai-video-gen;
    index index.html;
    client_max_body_size 50m;  # 支持大量图片上传

    # ffmpeg.wasm 需要的跨域头
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;

    # DashScope API 反向代理
    location /dashscope/ {
        proxy_pass https://dashscope-intl.aliyuncs.com/;
        proxy_set_header Host dashscope-intl.aliyuncs.com;
        proxy_ssl_server_name on;
        proxy_read_timeout 120s;
    }

    location / { try_files $uri $uri/ /index.html; }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/wasm;
}
```

注意：如果用户使用国内百炼API Key（非国际版），需要将 proxy_pass 改为 `https://dashscope.aliyuncs.com/`。

## API Key 管理
- 存储在 localStorage（key: `dashscope_api_key`）
- 首次打开弹窗要求输入
- 每个用户各自输入自己的 Key，天然支持多用户

## 开始构建
请按上述规范完整构建项目。先创建项目骨架和配置文件，然后实现各个功能模块。确保：
1. `npm run dev` 能正常启动
2. ffmpeg.wasm 能成功加载（不要出现加载挂起）
3. API 调用格式完全正确
4. 长视频的主角一致性逻辑正确
5. `npm run build` 能正常产出生产包
```

---

## 使用说明

1. 在 Qoder 中新建一个空目录
2. 将上面 "Prompt 正文" 部分完整复制粘贴给 Qoder
3. Qoder 会自动创建所有文件并安装依赖
4. 完成后执行 `npm run dev` 启动开发服务器
5. 在浏览器打开后输入你的 DashScope API Key 即可使用

## 注意事项

- 如果使用**国内百炼平台**的 API Key，需要将 vite.config.ts 中的 proxy target 改为 `https://dashscope.aliyuncs.com`
- ffmpeg-core 文件需要手动从 `node_modules/@ffmpeg/core/dist/esm/` 或 `dist/umd/` 复制到 `public/ffmpeg/`
- 生产部署时 COEP 头和 nginx proxy 配置是必须的
