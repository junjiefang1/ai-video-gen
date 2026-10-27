/**
 * 使用 Qwen 大模型将一个总体描述拆解为多段分镜 prompt
 * 有图片时使用视觉模型 qwen-vl-plus，可以直接看到图片内容来分配
 */

export interface SceneSegment {
  index: number
  prompt: string
  durationSec: number
  imageIndex?: number // 建议绑定的图片编号（从0开始），undefined表示不绑图
  dialogue?: string // 本段画外旁白/对白文本（中文为主），整段时长内显示在底部居中。视频模型生成的人物嘴型不与此对齐——本字段定位为"画外叙事字幕"
}

/**
 * 每张参考图的元数据：是否含密集文字（决定走 i2v 还是 t2v）
 * - hasDenseText=false：图干净（人脸特写/纯背景），可放心走 i2v 锁人物锁场景
 * - hasDenseText=true：图里有招牌/LED/横幅密集文字，i2v 会复刻产生乱码 → 强制走 t2v
 */
export interface ImageMeta {
  imageIndex: number // 0-based，对应 imageDataUrls 顺序
  hasDenseText: boolean
  reason?: string // VL 简短说明（如"含 LED 大屏多行英文"）
}

export interface DecomposeResult {
  globalStyle: string // 全局风格锚（人物/画风/色调/光线/镜头语言），需 prefix 到每段 prompt 开头
  scenes: SceneSegment[]
  imageMetas?: ImageMeta[] // 每张参考图的路由判断
}

const QWEN_PATH = '/dashscope/compatible-mode/v1/chat/completions'

export async function decomposePromptToScenes(
  apiKey: string,
  masterPrompt: string,
  totalDurationSec: number,
  segmentDurationSec: number,
  imageDataUrls?: string[], // base64 图片数据，有则使用视觉模型
  textRenderingChinese: 'garbled' | 'partial' | 'good' = 'garbled' // 视频模型中文文字渲染能力
): Promise<DecomposeResult> {
  const segmentCount = Math.ceil(totalDurationSec / segmentDurationSec)
  const hasImages = imageDataUrls && imageDataUrls.length > 0

  const imageInstruction = hasImages
    ? `\n6. 用户提供了 ${imageDataUrls!.length} 张参考图片（按传入顺序编号为 图片1、图片2...图片${imageDataUrls!.length}）。请仔细观察每张图片的实际内容：
   (a) 判断哪些分镜场景与哪张图片最匹配。对适合配图的分镜，在JSON中加入 "imageIndex" 字段（值为图片编号，从1开始）。不必所有分镜都配图，只配内容确实匹配的。【同一张图片最多分配给 2 个分镜（且应为不相邻的分镜），超过 2 段使用同一张图会造成“每段都从同一画面开始”的回放感】。
   (b) 【极其重要】对每张图，必须判断它是否含有"密集文字"。规则：图中如果有招牌、LED 大屏、横幅、海报、书本封面等显著且字数较多（超过 4 个汉字或 3 个英文单词）的文字 → hasDenseText=true；如果是人脸特写、纯净背景、无字招牌、模糊远景、自然风光等 → hasDenseText=false。这个判断会决定该图走图生视频(false)还是文生视频(true)路径，错判会导致乱码或浪费参考图。在 JSON 中输出 imageMetas 数组，每个元素 {"imageIndex":1, "hasDenseText":true/false, "reason":"简短说明"}。`
    : ''

  const systemMessage = `你是一位专业的视频分镜师。你需要将用户给出的视频总描述，拆解为${segmentCount}个连续的分镜片段，并产出全局风格锚 globalStyle。
每个片段时长${segmentDurationSec}秒。

【globalStyle 字段要求】
这是一段120-200字的全局风格描述，会被自动 prefix 到每个分镜prompt 开头，是保证整部视频视觉一致性的唯一手段（本系统全部采用文生视频模式，不依赖参考图锁定人物，所有人物一致性都靠此字段描述）。必须包含：
- **主要人物的固定外形（极其重要，越具体越好）**：性别年龄、具体发型发色（如“黑色短发三七分，右侧轻微复起”）、面部特征（如“方脸型、双眼皮、高鼻梁、轻微胡渣”）、体型、服装（具体颜色/面料/款式，如“深蓝色细格西服、金扣三粒、白衬衫、黑领带”）。如果用户上传了参考图，请仔细观察人物面容、发型、服装色调、体型轮廓，把这些特征设计到 globalStyle 中。
- 整体画风（如：电影感写实/赛博朋克/吉卜力动漫/水彩插画等）
- 统一色调与光线（如：暖黄夕阳/冷蓝月光/高对比霓虹）
- 镜头语言基调（如：手持纪实/平稳运镜/电影级稳定）
- **场景锚（极其重要）**：贯穿全片的核心环境/地点/背景元素（如：上世纪90年代香港霓虹街道、现代会议演讲厅、潮湿雨夜的居酒屋后巷）。如果用户上传了参考图，仔细观察图中背景/装饰/物件/建筑/天气，写进场景锚。
- **品牌/主题关键词（重要）**：如果参考图或用户描述里有会议/活动/产品的文字信息、logo、品牌名、标语，必须原样保留到 globalStyle 和分镜 prompt 中，不要删除或替换。
- **节奏推进**：明确表明本片是连续递进的剧情，每段都有新信息、不重复台词或动作
不要在 globalStyle 里描述具体剧情，只描述贯穿全片不变的"风格底色"和"环境底色"。

【分镜要求】
1. 每个分镜描述独立且具体，包含画面内容、镜头运动、光线氛围
2. 分镜之间必须有强连贯性：
   - 第2镜起，每条 prompt 开头明确写出“承接上一镜的XX”（例如承接上一镜结尾的人物动作、视角、所在地点）
   - 相邻分镜的场景空间、人物状态、时间应自然递进，不可跳跃到完全无关的场景
   - 镜头运动要有衔接（例如上一镜推近 → 这一镜环绕；上一镜仰视 → 这一镜慢慢平视）
3. 【严禁重复】相邻分镜不允许出现重复台词/重复动作/重复画面：
   - 每段必须推进剧情或增加新信息（新动作/新说的话/新路人/新表情/新镜头角度）
   - 不可在不同分镜里重复同一句对白或同一个动作描述
   - 每镜要能回答“这一镜比上一镜多了什么新内容”
4. 【镜头运动/景别必须递变】防止“段头回放”观感：
   - 相邻两段不允许使用相同的“景别+运镜”组合。景别可选：特写/近景/中景/全景/远景；运镜可选：推/拉/摇/移/环绕/跟随/手持晃动/升降
   - 全片全局看有明显的镜头节奏变化，不要所有镜都是“中景平推”这种同一质感
   - 在 prompt 中明确写出本镜的景别与运镜（例如“运镜：从人物身后缓慢环绕到正面；景别：近景”）
5. 全片所有分镜的人物外形、服装、画风必须完全一致（globalStyle 已规定，分镜里不要冲突描述）
6. 描述要适合AI视频生成模型理解，避免抽象概念
7. 每条 prompt 控制在60-120字之间，不要重复 globalStyle 已经描述过的风格内容
8. 【画面里的文字处理 - 最高优先级】
   - 用户原文或改写结果中出现的任何品牌名（如 FWD、Nike、Apple）、logo、标语、slogan、可读文字，必须原样保留在分镜 prompt 中
   - 绝对禁止把用户指定的品牌文字删除、替换为"留白区域""无文字""无标识""仅几何图案"等回避性描述
   - 中英文文字均可直接写入 prompt，模型会尝试渲染
   - 例如用户写了"FWD品牌logo出现在屏幕上"，分镜里就必须有"屏幕显示 FWD logo"的具体描述，不可改为"屏幕泡出模糊图案"
9. 【对白字幕 dialogue - 重要】每段视频会在底部居中烧录一条字幕（白字黑描边的标准字幕样式），用于呈现本段的"画外旁白"或"主要对白文本"，规则：
   - dialogue 字段是一行简短中文文本，对应本段视频画面正在表达的核心台词或叙事旁白（视频模型生成的人物嘴型不会与此对齐，定位是"画外叙事字幕"，无需追求口型同步）
   - 长度控制：单段 dialogue 控制在 8-30 个汉字（再长字幕会换行影响观感）
   - 内容要求：必须推动剧情、有信息量；不要重复 prompt 里的画面描述、不要重复上一段的字幕；语气自然口语化
   - 没有合适旁白的段（纯环境镜头/纯动作过渡）可以填空字符串 ""，不会显示字幕${imageInstruction}

请严格按如下JSON对象格式输出，不要输出其他任何内容：
{"globalStyle":"全局风格描述","scenes":[{"index":1,"prompt":"分镜1描述"${hasImages ? ',"imageIndex":1' : ''},"dialogue":"本段画外旁白文本"},{"index":2,"prompt":"承接上一镜...，分镜2描述","dialogue":""}]${hasImages ? ',"imageMetas":[{"imageIndex":1,"hasDenseText":false,"reason":"简短说明"}]' : ''}}
注意：每段必须包含 dialogue 字段（无旁白时填 ""）。dialogue 是中文叙事字幕，控制在 8-30 个汉字。`

  // 构建 messages
  type MessageContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  const messages: Array<{ role: string; content: MessageContent }> = [
    { role: 'system', content: systemMessage },
  ]

  // 有图片时，用户消息包含图片（视觉模型能直接看到）
  if (hasImages) {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
    for (let i = 0; i < imageDataUrls.length; i++) {
      content.push({ type: 'image_url', image_url: { url: imageDataUrls[i] } })
    }
    content.push({ type: 'text', text: `以上是用户提供的 ${imageDataUrls.length} 张参考图片（按顺序为图片1~${imageDataUrls.length}）。\n\n视频总描述: ${masterPrompt}\n\n请先产出 globalStyle，再拆解为${segmentCount}个连贯分镜（每个${segmentDurationSec}秒），并根据图片内容将合适的图片分配到对应分镜。输出JSON对象。` })
    messages.push({ role: 'user', content })
  } else {
    messages.push({ role: 'user', content: `视频总描述: ${masterPrompt}\n\n请先产出 globalStyle，再拆解为${segmentCount}个连贯分镜，每个${segmentDurationSec}秒。输出JSON对象。` })
  }

  const response = await fetch(QWEN_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: hasImages ? 'qwen-vl-plus' : 'qwen-plus',
      messages,
      temperature: 0.7,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `Qwen API 调用失败: ${response.status}`)
  }

  const content = data.choices?.[0]?.message?.content || ''

  // 优先尝试解析 JSON 对象 {globalStyle, scenes, imageMetas}；兼容旧格式数组
  let globalStyle = ''
  let scenes: { index: number; prompt: string; imageIndex?: number; dialogue?: string }[] = []
  let rawImageMetas: { imageIndex: number; hasDenseText: boolean; reason?: string }[] = []

  const objMatch = content.match(/\{[\s\S]*\}/)
  const arrMatch = content.match(/\[[\s\S]*\]/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0])
      if (parsed && Array.isArray(parsed.scenes)) {
        globalStyle = String(parsed.globalStyle || '').trim()
        scenes = parsed.scenes
        if (Array.isArray(parsed.imageMetas)) {
          rawImageMetas = parsed.imageMetas
        }
      }
    } catch {
      // 落到下面的数组分支
    }
  }
  if (scenes.length === 0 && arrMatch) {
    try {
      scenes = JSON.parse(arrMatch[0])
    } catch {
      // 忽略
    }
  }
  if (scenes.length === 0) {
    throw new Error('无法从Qwen响应中解析分镜列表')
  }

  // 兜底清洗：按模型中文字符渲染能力调节清洗强度。
  // garbled（HappyHorse 等必乱码）→ 强清洗，删除所有中文引号文本
  // partial（Kling 等部分可控）→ 中清洗，保留短中文品牌词
  // good（Muledance 等原生中文）→ 弱清洗，仅去叠加文字描述
  if (textRenderingChinese !== 'good') {
    globalStyle = sanitizeNoText(globalStyle, textRenderingChinese)
    scenes = scenes.map(s => ({ ...s, prompt: sanitizeNoText(s.prompt, textRenderingChinese) }))
  } else {
    // Muledance 等中文渲染强的模型：仅删除"叠加文字指令"（如"字幕为XX"/"标题为XX"），不删品牌文字描述
    globalStyle = sanitizeNoTextLight(globalStyle)
    scenes = scenes.map(s => ({ ...s, prompt: sanitizeNoTextLight(s.prompt) }))
  }

  // 把 imageMetas 的 imageIndex 从 1-based 转为 0-based；缺漏的图默认 hasDenseText=false（保守按 i2v 走）
  const imageMetas: ImageMeta[] | undefined = hasImages
    ? imageDataUrls!.map((_, i) => {
        const found = rawImageMetas.find(m => m.imageIndex === i + 1)
        return found
          ? { imageIndex: i, hasDenseText: !!found.hasDenseText, reason: found.reason }
          : { imageIndex: i, hasDenseText: false, reason: '未识别，默认按干净图处理' }
      })
    : undefined

  return {
    globalStyle,
    scenes: scenes.map((s, i) => ({
      index: i + 1,
      prompt: typeof s.prompt === 'string' ? s.prompt : safeStringify(s.prompt),
      durationSec: segmentDurationSec,
      imageIndex: s.imageIndex ? s.imageIndex - 1 : undefined, // 转为0-based
      dialogue: sanitizeDialogue(s.dialogue),
    })),
    imageMetas,
  }
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 清洗 dialogue：去除多余空白、超长截断（>30 个汉字截断），空内容返回 undefined
 */
function sanitizeDialogue(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined
  const trimmed = s.trim()
  if (!trimmed) return undefined
  // 估算长度：中英文字符各算 1，最多保留 30 个字符。超长直接截断（不刻意"...省略号"，简洁优先）
  const MAX = 30
  return trimmed.length > MAX ? trimmed.slice(0, MAX) : trimmed
}

/**
 * 兜底清洗：按中文字符渲染能力分档处理
 * - garbled（HappyHorse 等必乱码）：删除所有中文引号文本、《》、"字幕为/标题为/显示..."
 * - partial（Kling 等部分可控）：保留 1-4 个汉字的短中文品牌词，删除长中文句
 * 英文短引号词（1-3 个单词）两种模式都保留
 */
function sanitizeNoText(text: string, textRenderingChinese: 'garbled' | 'partial'): string {
  if (!text) return text
  let out = text
  const allowShortChinese = textRenderingChinese === 'partial'

  // 1) 引号内文本：按中文渲染能力决定保留/删除
  out = out.replace(/['‘’“”"]([^'‘’“”"]+)['‘’“”"]/g, (match, inner: string) => {
    const trimmed = inner.trim()
    // 含中文字符
    if (/[\u4e00-\u9fa5]/.test(trimmed)) {
      if (allowShortChinese) {
        // 短中文（≤4 汉字，且无标点）保留；否则删除
        const chineseOnly = trimmed.replace(/[a-zA-Z0-9\s]/g, '')
        const hasPunct = /[,，。\.、;：:!！?？]/.test(trimmed)
        if (chineseOnly.length <= 4 && !hasPunct && trimmed.length <= 8) {
          return match // 保留短中文品牌词
        }
        return '' // 删除长中文句
      }
      return '' // garbled 模式删除所有中文
    }
    // 纯英文检查
    const enWordCount = trimmed.split(/\s+/).filter((w: string) => /^[A-Za-z0-9\-]+$/.test(w)).length
    if (enWordCount > 3) return ''
    if (trimmed.length > 18) return ''
    if (/[,，。\.、;：:!！?？]/.test(trimmed)) return ''
    return match
  })

  // 2) 《》处理
  out = out.replace(/《([^《》]+)》/g, (match, inner: string) => {
    if (!allowShortChinese) return '' // garbled 模式全删
    // partial 模式：保留短中文
    if (inner.length > 6) return ''
    return match
  })

  // 3) 删除"字幕为""标题为"等叠加文字指令
  out = out.replace(/字幕为[^，。；;]*?(?=[，。；;]|$)/g, '')
  out = out.replace(/(主标题|大标题|标语|横幅字)为[^，。；;]*?(?=[，。；;]|$)/g, '')

  // 4) 删除"显示/写出/标出/刻上/写着"的叠加文字要求
  out = out.replace(/(?:显示|写出|标出|刻上|写着)[^，。；;]*?(?=[，。；;]|$)/g, '')

  // 5) 压缩多余空格、连续标点
  out = out.replace(/\s+/g, ' ').replace(/([，,。；;])\1+/g, '$1').replace(/^[\s，,。；;]+/, '').trim()

  return out
}

/**
 * 轻度清洗：仅删除"叠加文字指令"（字幕为XX、标题为XX、显示XX），
 * 保留所有中文品牌文字描述（Muledance 等中文渲染好的模型使用）
 */
function sanitizeNoTextLight(text: string): string {
  if (!text) return text
  let out = text
  out = out.replace(/字幕为[^，。；;]*?(?=[，。；;]|$)/g, '')
  out = out.replace(/(主标题|大标题|标语|横幅字)为[^，。；;]*?(?=[，。；;]|$)/g, '')
  out = out.replace(/(?:显示|写出|标出|刻上|写着)[^，。；;]*?(?=[，。；;]|$)/g, '')
  out = out.replace(/\s+/g, ' ').replace(/([，,。；;])\1+/g, '$1').replace(/^[\s，,。；;]+/, '').trim()
  return out
}
