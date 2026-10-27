/**
 * 阿里云百炼 HappyHorse 视频生成 API 封装
 */

const DASHSCOPE_BASE = '/dashscope';
const VIDEO_SYNTHESIS_PATH = '/api/v1/services/aigc/video-generation/video-synthesis';
const TASK_QUERY_PATH = '/api/v1/tasks';

export type VideoMode = 'text-to-video' | 'image-to-video' | 'video-edit';

export interface TextToVideoParams {
  prompt: string;
  resolution?: '480p' | '720p' | '1080p';
  duration?: number;
  language?: 'zh' | 'en' | 'yue';
}

export interface ImageToVideoParams {
  prompt: string;
  imageUrl: string;
  resolution?: '480p' | '720p' | '1080p';
  duration?: number;
  language?: 'zh' | 'en' | 'yue';
}

export interface VideoEditParams {
  prompt: string;
  videoUrl: string;
  refImageUrl?: string;
}

export interface TaskResult {
  taskId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  videoUrl?: string;
  message?: string;
}

function getModelName(mode: VideoMode): string {
  switch (mode) {
    case 'text-to-video':
      return 'happyhorse-1.1-t2v';
    case 'image-to-video':
      return 'happyhorse-1.1-i2v';
    case 'video-edit':
      return 'happyhorse-1.0-video-edit'; // 视频编辑暂无 1.1 版本
  }
}

function appendLanguageHint(prompt: string, language?: 'zh' | 'en' | 'yue'): string {
  if (!language || language === 'zh') return prompt;
  const hints: Record<string, string> = {
    en: 'English dialogue and narration, Western cultural setting.',
    yue: '粤语对白及旁白，香港风格场景，Cantonese dialogue.',
  };
  return `${prompt}\n${hints[language]}`;
}

// 负面提示词：只抑制"清晰可读的文字、乱码、拼写错误的字符"，不禁招牌/屏幕/横幅本身存在。
// 思路：让模型生成装饰性、模糊、文字纹理感的背景字，避免它试图渲染具体字符产生乱码。
const NO_TEXT_NEGATIVE = '乱码,错别字,拼写错误的字母,拙劣的文字,变形的汉字,渲染错误的文字,清晰的大段文字,主体上的字幕,画面中央的标题,gibberish text,garbled text,misspelled words,distorted letters,malformed characters,unreadable scribbles,nonsense text,fake characters,corrupted typography';

export async function submitTextToVideo(
  apiKey: string,
  params: TextToVideoParams
): Promise<TaskResult> {
  const model = getModelName('text-to-video');
  const body = {
    model,
    input: {
      prompt: appendLanguageHint(params.prompt, params.language),
      negative_prompt: NO_TEXT_NEGATIVE,
    },
    parameters: {
      resolution: (params.resolution || '720p').toUpperCase(),
      duration: params.duration || 5,
    },
  };

  return submitTask(apiKey, body);
}

export async function submitImageToVideo(
  apiKey: string,
  params: ImageToVideoParams
): Promise<TaskResult> {
  const model = getModelName('image-to-video');
  const body = {
    model,
    input: {
      prompt: appendLanguageHint(params.prompt, params.language),
      negative_prompt: NO_TEXT_NEGATIVE,
      media: [{ type: 'first_frame', url: params.imageUrl }],
    },
    parameters: {
      resolution: (params.resolution || '720p').toUpperCase(),
      duration: params.duration || 5,
    },
  };

  return submitTask(apiKey, body);
}

export async function submitVideoEdit(
  apiKey: string,
  params: VideoEditParams
): Promise<TaskResult> {
  const model = getModelName('video-edit');
  const input: Record<string, string> = {
    prompt: params.prompt,
    video_url: params.videoUrl,
  };
  if (params.refImageUrl) {
    input.ref_img_url = params.refImageUrl;
  }
  const body = {
    model,
    input,
    parameters: {},
  };

  return submitTask(apiKey, body);
}

async function submitTask(
  apiKey: string,
  body: Record<string, unknown>
): Promise<TaskResult> {
  let response: Response;
  try {
    response = await fetch(`${DASHSCOPE_BASE}${VIDEO_SYNTHESIS_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      taskId: '',
      status: 'FAILED',
      message: `网络错误: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    return {
      taskId: '',
      status: 'FAILED',
      message: `HTTP ${response.status} ${response.statusText} (响应非JSON)`,
    };
  }

  if (!response.ok) {
    const code = data?.code ? `[${data.code}] ` : '';
    const reqId = data?.request_id ? ` (req=${data.request_id})` : '';
    return {
      taskId: '',
      status: 'FAILED',
      message: `${code}${data?.message || `HTTP ${response.status}`}${reqId}`,
    };
  }

  return {
    taskId: data.output?.task_id || '',
    status: mapStatus(data.output?.task_status),
    message: data.output?.message,
  };
}

export async function queryTask(apiKey: string, taskId: string): Promise<TaskResult> {
  const response = await fetch(`${DASHSCOPE_BASE}${TASK_QUERY_PATH}/${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      taskId,
      status: 'FAILED',
      message: data?.message || `查询失败: ${response.status}`,
    };
  }

  const output = data.output || {};
  return {
    taskId,
    status: mapStatus(output.task_status),
    videoUrl: output.video_url || output.results?.[0]?.url,
    message: output.message || output.task_metrics?.TOTAL,
  };
}

function mapStatus(status: string | undefined): TaskResult['status'] {
  switch (status) {
    case 'PENDING':
      return 'PENDING';
    case 'RUNNING':
      return 'RUNNING';
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}
