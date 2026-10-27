/**
 * 使用 Qwen 大模型对用户的视频描述进行专业改写
 * 采用 few-shot + response_format 确保结构化输出
 */

const QWEN_PATH = '/dashscope/compatible-mode/v1/chat/completions'

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

export type RewriteContext = 'text-to-video' | 'image-to-video' | 'video-edit' | 'long-video' | 'batch'

export interface RewriteResult {
  rewritten: string
  highlights: string[]
}

interface FewShotConfig {
  system: string
  userExample: string
  assistantExample: string
}

const FEW_SHOT_CONFIGS: Record<RewriteContext, FewShotConfig> = {
  'text-to-video': {
    system: '你是视频prompt改写工具。将用户的简短视频描述改写为结构化的AI视频生成prompt，包含5个维度：【画面主体】【镜头运动】【光线】【风格质感】【环境氛围】。每个维度15-30字。只输出JSON。',
    userExample: '一只猫在窗台晒太阳',
    assistantExample: JSON.stringify({
      rewritten: '【画面主体】橘色长毛猫慵懒趴在木质窗台，尾巴轻摆\n【镜头运动】缓慢推进，从中景过渡到面部特写\n【光线】午后暖阳斜射，丁达尔光束透过玻璃\n【风格质感】浅景深虚化背景绿植，暖色调电影感\n【环境氛围】窗纱随微风轻飘，光束中尘埃缓缓漂浮',
      highlights: ['丁达尔光束增强层次', '浅景深突出主体', '缓推镜头营造静谧'],
    }),
  },
  'image-to-video': {
    system: '你是视频prompt改写工具。用户已有首帧图片，需要描述画面如何动起来。改写为结构化prompt，包含4个维度：【主体运动】【镜头运动】【光影变化】【环境动态】。每个维度15-30字。只输出JSON。',
    userExample: '花朵逐渐绽放',
    assistantExample: JSON.stringify({
      rewritten: '【主体运动】花瓣从紧闭花苞缓缓展开，层层舒展露出花蕊\n【镜头运动】固定机位微距拍摄，焦点从花瓣边缘渐移至花蕊\n【光影变化】晨光渐强，花瓣上露珠折射出彩虹微光\n【环境动态】背景虚化中隐约有蜜蜂飞过，叶片微微晃动',
      highlights: ['微距特写展现花瓣纹理', '露珠折射增加光影层次', '渐进式运动适合延时感'],
    }),
  },
  'video-edit': {
    system: '你是视频编辑prompt改写工具。将用户的编辑指令改写为结构化格式，包含4个维度：【编辑目标】【风格参考】【保留内容】【细节增强】。每个维度15-30字。只输出JSON。',
    userExample: '把视频变成赛博朋克风格',
    assistantExample: JSON.stringify({
      rewritten: '【编辑目标】整体转为赛博朋克霓虹都市风格，色调偏冷蓝紫\n【风格参考】银翼杀手2049霓虹灯光感，高饱和荧光色点缀\n【保留内容】保持人物动作轨迹和原始构图不变\n【细节增强】添加雨滴粒子效果，地面湿滑反光，远处全息广告牌',
      highlights: ['银翼杀手风格参考明确', '保留原始运动轨迹', '雨滴全息细节增强氛围'],
    }),
  },
  'long-video': {
    system: `你是长视频分镜改写工具。将用户的视频总描述改写为结构化的分镜规划。只输出JSON，格式：{"rewritten": "...", "highlights": [...]}。其中 rewritten 字段必须是一个字符串（不是对象），字符串内包含4个维度（维度之间用换行分隔）：【叙事线】...、【视觉风格】...、【节奏设计】...、【分镜概要】...，分镜概要用编号列出各镜头段落。
 
 【最高优先级规则 - 品牌/文字保留】：
 - 用户原文中出现的任何品牌名（如 FWD、Nike、Apple 等）、logo 描述、标语、slogan、可读文字，必须在 rewritten 字符串的分镜概要中显式出现，不允许删除、省略、替换为"无文字"或"留白"。
 - 如果用户写了"FWD品牌logo"，分镜里就必须有"FWD logo"出现的具体画面描述。
 - 绝对禁止把用户指定的品牌文字改写为"无标识""无文字""仅几何图案"等回避性描述。
 
 其他规则：
 - 【严禁重复】相邻分镜不能出现重复台词/重复动作/重复画面，每段必须推进剧情或增加新信息。
 只输出JSON。`,
    userExample: '记录一天从早到晚的城市生活',
    assistantExample: JSON.stringify({
      rewritten: '【叙事线】清晨宁静→早高峰涌动→午间繁忙→傍晚归途→夜幕霓虹\n【视觉风格】全程电影级暖色调，浅景深，统一胶片颗粒质感\n【节奏设计】开篇慢节奏延时→中段加速快切→结尾回归舒缓\n【分镜概要】\n1. [延时] 天际线从暗蓝渐变橙红，城市轮廓显现\n2. [跟拍] 上班族汇入地铁站，人流如织\n3. [俯瞰] 午间CBD车流穿梭如血脉\n4. [平移] 黄昏街道，路灯依次亮起\n5. [固定] 夜晚天台俯瞰，霓虹璀璨',
      highlights: ['时间线叙事结构清晰', '快慢交替节奏设计', '5段分镜覆盖全天'],
    }),
  },
  'batch': {
    system: '你是视频prompt改写工具。将用户描述改写为结构化格式：【画面主体】【镜头运动】【光线风格】【氛围】。每个维度15-25字。只输出JSON。',
    userExample: '海浪拍打礁石',
    assistantExample: JSON.stringify({
      rewritten: '【画面主体】湛蓝海浪猛烈拍击黑色礁石，白色浪花飞溅\n【镜头运动】低角度仰拍，慢动作捕捉浪花碎裂瞬间\n【光线风格】逆光拍摄，阳光穿透浪尖形成金色光晕\n【氛围】海风呼啸，远处海鸥掠过，雾气弥漫',
      highlights: ['慢动作凝固浪花瞬间', '逆光穿透效果', '低角度增强冲击力'],
    }),
  },
}

export async function rewritePrompt(
  apiKey: string,
  userPrompt: string,
  context: RewriteContext,
  options?: { duration?: number; resolution?: string; imageDataUrls?: string[] }
): Promise<RewriteResult> {
  const config = FEW_SHOT_CONFIGS[context]
  const extraInfo = [
    options?.duration ? `${options.duration}秒` : '',
    options?.resolution || '',
  ].filter(Boolean).join('，')

  const hasImages = options?.imageDataUrls && options.imageDataUrls.length > 0
  const model = hasImages ? 'qwen-vl-plus' : 'qwen-plus'

  // 有图片时，使用视觉模型 + 增强的 system prompt
  const systemPrompt = hasImages && context === 'long-video'
    ? `${config.system}\n\n重要：用户提供了 ${options!.imageDataUrls!.length} 张参考图片（按传入顺序编号为 图片1、图片2...）。请仔细分析每张图片的内容（场景、人物、物体、氛围等），将这些图片元素自然融入你的分镜规划中。在【分镜概要】中，对于适合使用某张图片的分镜，请在该分镜描述末尾标注 [配图N]（N为图片编号，从1开始）。不需要每个分镜都配图，只标注确实匹配的。图片不必按顺序使用，根据内容逻辑自行安排最佳位置。`
    : config.system

  const userText = extraInfo ? `${userPrompt}（${extraInfo}）` : userPrompt

  // 构建 messages
  type MessageContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  const messages: Array<{ role: string; content: MessageContent }> = [
    { role: 'system', content: systemPrompt },
  ]

  // 有图片时不使用 few-shot（视觉模型对多模态 few-shot 支持有限）
  if (!hasImages) {
    messages.push(
      { role: 'user', content: config.userExample },
      { role: 'assistant', content: config.assistantExample },
    )
  }

  // 构建用户消息（带图片或纯文本）
  if (hasImages) {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
    for (const imgUrl of options!.imageDataUrls!) {
      content.push({ type: 'image_url', image_url: { url: imgUrl } })
    }
    content.push({ type: 'text', text: `视频总描述：${userText}\n\n请分析以上图片内容，结合视频描述，输出结构化的分镜规划JSON。格式：{"rewritten": "...", "highlights": [...]}` })
    messages.push({ role: 'user', content })
  } else {
    messages.push({ role: 'user', content: userText })
  }

  const response = await fetch(QWEN_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: hasImages ? undefined : { type: 'json_object' },
      messages,
      temperature: 0.7,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `Qwen API 调用失败: ${response.status}`)
  }

  const content = data.choices?.[0]?.message?.content || ''

  try {
    const result = JSON.parse(content)
    // 标准格式: {rewritten, highlights}
    if (result.rewritten) {
      return {
        rewritten: typeof result.rewritten === 'string' ? result.rewritten : safeStringify(result.rewritten),
        highlights: Array.isArray(result.highlights) ? result.highlights : [],
      }
    }
    // 兼容格式: 标签作为JSON key，如 {"【画面主体】": "...", "【镜头运动】": "..."}
    const tagKeys = Object.keys(result).filter(k => k.startsWith('【'))
    if (tagKeys.length > 0) {
      const rewritten = tagKeys.map(k => `${k}${result[k]}`).join('\n')
      return { rewritten, highlights: Array.isArray(result.highlights) ? result.highlights : ['结构化改写完成'] }
    }
    // 兼容格式: 长视频扁平结构 {narrative_line, visual_style, rhythm_design, shot_summary}
    const longVideoKeys = ['narrative_line', 'visual_style', 'rhythm_design', 'shot_summary']
    if (longVideoKeys.some(k => result[k])) {
      const rewritten = longVideoKeys
        .filter(k => result[k])
        .map(k => `【${k.replace(/_/g, '')}】${result[k]}`)
        .join('\n')
      return { rewritten, highlights: ['已增强描述细节'] }
    }
    return { rewritten: content.trim(), highlights: ['已增强描述细节'] }
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const r = JSON.parse(jsonMatch[0])
        if (r.rewritten) return { rewritten: typeof r.rewritten === 'string' ? r.rewritten : safeStringify(r.rewritten), highlights: Array.isArray(r.highlights) ? r.highlights : [] }
        const tagKeys = Object.keys(r).filter(k => k.startsWith('【'))
        if (tagKeys.length > 0) {
          return { rewritten: tagKeys.map(k => `${k}${r[k]}`).join('\n'), highlights: ['结构化改写完成'] }
        }
        const longVideoKeys = ['narrative_line', 'visual_style', 'rhythm_design', 'shot_summary']
        if (longVideoKeys.some(k => r[k])) {
          const rewritten = longVideoKeys
            .filter(k => r[k])
            .map(k => `【${k.replace(/_/g, '')}】${r[k]}`)
            .join('\n')
          return { rewritten, highlights: ['已增强描述细节'] }
        }
      } catch { /* fall through */ }
    }
    return { rewritten: content.trim(), highlights: ['已增强描述细节'] }
  }
}

/**
 * 批量改写多条prompt
 */
export async function rewritePromptBatch(
  apiKey: string,
  prompts: string[],
  context: RewriteContext,
  options?: { duration?: number; resolution?: string },
  onProgress?: (done: number, total: number) => void
): Promise<RewriteResult[]> {
  const results: RewriteResult[] = []
  for (let i = 0; i < prompts.length; i++) {
    const result = await rewritePrompt(apiKey, prompts[i], context, options)
    results.push(result)
    onProgress?.(i + 1, prompts.length)
  }
  return results
}
