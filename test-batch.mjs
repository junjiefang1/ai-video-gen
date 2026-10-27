/**
 * 批量模式测试脚本 - 模拟 useBatchQueue 逻辑
 * 2并发 × 4任务 × 5秒视频
 */

const API_KEY = 'sk-72c080e877be46b2aab359bcba79e51e';
const BASE_URL = 'https://dashscope-intl.aliyuncs.com';
const SUBMIT_PATH = '/api/v1/services/aigc/video-generation/video-synthesis';
const TASK_PATH = '/api/v1/tasks';

const PROMPTS = [
  'A red fox running through a snowy forest at dusk, cinematic lighting, slow motion',
  'Ocean waves crashing on black volcanic rocks, aerial view, dramatic clouds',
  'A steam train crossing a stone bridge in misty mountains, golden hour light',
  'Colorful hot air balloons rising above green hills at sunrise, time lapse style',
];

const CONCURRENCY = 2;

async function submitTask(prompt) {
  const res = await fetch(`${BASE_URL}${SUBMIT_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: 'happyhorse-1.0-t2v',
      input: { prompt },
      parameters: { resolution: '720P', duration: 5 },
    }),
  });
  return res.json();
}

async function queryTask(taskId) {
  const res = await fetch(`${BASE_URL}${TASK_PATH}/${taskId}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function processTask(index, prompt) {
  console.log(`[${timestamp()}] #${index + 1} 提交: "${prompt.slice(0, 40)}..."`);
  const submitResult = await submitTask(prompt);

  if (!submitResult.output?.task_id) {
    console.log(`[${timestamp()}] #${index + 1} 提交失败:`, submitResult.message || submitResult);
    return { index, status: 'FAILED', error: submitResult.message };
  }

  const taskId = submitResult.output.task_id;
  console.log(`[${timestamp()}] #${index + 1} 已提交 task_id=${taskId.slice(0, 8)}...`);

  // 轮询
  while (true) {
    await sleep(10000); // 10秒轮询
    const result = await queryTask(taskId);
    const status = result.output?.task_status;

    if (status === 'SUCCEEDED') {
      const videoUrl = result.output?.video_url;
      console.log(`[${timestamp()}] #${index + 1} ✓ 生成完成! URL=${videoUrl?.slice(0, 60)}...`);
      return { index, status: 'SUCCEEDED', videoUrl, taskId };
    } else if (status === 'FAILED') {
      console.log(`[${timestamp()}] #${index + 1} ✗ 失败: ${result.output?.message}`);
      return { index, status: 'FAILED', error: result.output?.message, taskId };
    } else {
      console.log(`[${timestamp()}] #${index + 1} 状态: ${status}`);
    }
  }
}

async function runBatch() {
  console.log('========================================');
  console.log(`批量模式测试: ${PROMPTS.length}个任务, 并发${CONCURRENCY}, 每个5秒`);
  console.log('========================================\n');

  const startTime = Date.now();
  const results = [];
  const queue = PROMPTS.map((prompt, i) => ({ index: i, prompt }));
  const active = new Set();

  // 并发控制器
  async function runNext() {
    if (queue.length === 0) return;
    const task = queue.shift();
    active.add(task.index);
    const result = await processTask(task.index, task.prompt);
    results.push(result);
    active.delete(task.index);
    // 有空位则继续
    if (queue.length > 0) {
      await runNext();
    }
  }

  // 启动并发数个worker
  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, PROMPTS.length); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n========================================');
  console.log(`全部完成! 总耗时: ${elapsed}秒`);
  console.log('========================================');
  console.log('\n结果汇总:');
  results.sort((a, b) => a.index - b.index);
  for (const r of results) {
    const statusIcon = r.status === 'SUCCEEDED' ? '✓' : '✗';
    console.log(`  #${r.index + 1} [${statusIcon} ${r.status}] ${r.videoUrl ? r.videoUrl.slice(0, 80) + '...' : r.error || ''}`);
  }

  const succeeded = results.filter(r => r.status === 'SUCCEEDED').length;
  const failed = results.filter(r => r.status !== 'SUCCEEDED').length;
  console.log(`\n统计: ${succeeded} 成功, ${failed} 失败`);
}

runBatch().catch(console.error);
