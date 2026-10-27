import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import https from 'https'
import http from 'http'
import { URL } from 'url'
import crypto from 'crypto'

// 通用视频/资源代理：/proxy-fetch?url=<encoded-url>
// 解决浏览器对第三方 CDN（如字节跳动/Volc）无 CORS 头时无法 fetch 的问题
function proxyFetchPlugin() {
  return {
    name: 'proxy-fetch-middleware',
    configureServer(server: any) {
      server.middlewares.use('/proxy-fetch', (req: any, res: any) => {
        try {
          const reqUrl = new URL(req.url, 'http://localhost')
          const target = reqUrl.searchParams.get('url')
          if (!target) {
            res.statusCode = 400
            res.end('missing url')
            return
          }
          const u = new URL(target)
          const lib = u.protocol === 'http:' ? http : https
          const reqOpts = {
            method: req.method || 'GET',
            headers: {
              // 透传必要 header，去掉浏览器特有的
              'user-agent': 'Mozilla/5.0',
              'accept': '*/*',
            },
          }
          const upstream = lib.request(u, reqOpts, (upRes) => {
            res.statusCode = upRes.statusCode || 200
            // 强制允许跨域（虽然同源访问无需，但保险起见）
            res.setHeader('Access-Control-Allow-Origin', '*')
            const ct = upRes.headers['content-type']
            const cl = upRes.headers['content-length']
            if (ct) res.setHeader('Content-Type', ct)
            if (cl) res.setHeader('Content-Length', cl)
            upRes.pipe(res)
          })
          upstream.on('error', (err) => {
            console.error('[proxy-fetch] upstream error:', err.message)
            if (!res.headersSent) {
              res.statusCode = 502
              res.end('upstream error: ' + err.message)
            }
          })
          upstream.setTimeout(120000, () => {
            upstream.destroy(new Error('timeout'))
          })
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            req.pipe(upstream)
          } else {
            upstream.end()
          }
        } catch (e: any) {
          res.statusCode = 500
          res.end('proxy error: ' + (e?.message || e))
        }
      })
    },
  }
}

/**
 * 通过 OSS 接入点（Access Point）上传对象。
 * ali-oss Node.js SDK 不支持接入点别名，因此这里使用 OSS 签名 V1 手动构造 PUT 请求。
 */
async function putObjectViaAccessPoint({
  endpoint,
  accessPointAlias,
  accessKeyId,
  accessKeySecret,
  objectName,
  buffer,
  contentType,
}: {
  endpoint: string
  accessPointAlias: string
  accessKeyId: string
  accessKeySecret: string
  objectName: string
  buffer: Buffer
  contentType: string
}): Promise<string> {
  // 统一 endpoint 格式：https://xxx.oss-cn-xxx.oss-accesspoint.aliyuncs.com
  let ep = endpoint.trim()
  if (!ep.startsWith('http')) {
    ep = 'https://' + ep
  }
  const epUrl = new URL(ep)
  const host = epUrl.host

  const contentMd5 = crypto.createHash('md5').update(buffer).digest('base64')
  const date = new Date().toUTCString()
  const canonicalResource = `/${accessPointAlias}/${objectName}`
  // OSS 签名 V1：所有 x-oss-* 头部需要按字母序加入 CanonicalizedOSSHeaders
  const canonicalOssHeaders = 'x-oss-object-acl:public-read\n'

  const stringToSign = `PUT\n${contentMd5}\n${contentType}\n${date}\n${canonicalOssHeaders}${canonicalResource}`
  const signature = crypto
    .createHmac('sha1', accessKeySecret)
    .update(stringToSign)
    .digest('base64')
  const authorization = `OSS ${accessKeyId}:${signature}`

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path: `/${objectName}`,
        method: 'PUT',
        headers: {
          Host: host,
          Date: date,
          'Content-Type': contentType,
          'Content-MD5': contentMd5,
          'Content-Length': buffer.length,
          Authorization: authorization,
          'x-oss-object-acl': 'public-read',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(`https://${host}/${objectName}`)
          } else {
            reject(new Error(`OSS 接入点上传失败 (HTTP ${res.statusCode}): ${body}`))
          }
        })
      }
    )
    req.on('error', (err) => reject(err))
    req.write(buffer)
    req.end()
  })
}

/**
 * 本地图片 → 阿里云 OSS 中转上传。
 * 由于 MuleRouter 只接受公网 HTTP(S) URL 作为首帧/尾帧，本地图片必须经过图床。
 * 这里用 dev server 做中转：前端把 base64 图片传给 /upload-to-oss，Node 端上传到 OSS，
 * 返回公网 URL。OSS 凭据从 .env.local 读取，不会暴露到前端。
 */
function uploadToOssPlugin() {
  return {
    name: 'upload-to-oss-middleware',
    configureServer(server: any) {
      // Vite 会加载 .env / .env.local 到 process.env
      const env = loadEnv('development', process.cwd(), 'OSS_')
      const accessKeyId = env.OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID
      const accessKeySecret = env.OSS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET
      const bucket = env.OSS_BUCKET || process.env.OSS_BUCKET
      const region = env.OSS_REGION || process.env.OSS_REGION
      const endpoint = env.OSS_ENDPOINT || process.env.OSS_ENDPOINT
      const accessPointAlias = env.OSS_ACCESS_POINT_ALIAS || process.env.OSS_ACCESS_POINT_ALIAS

      server.middlewares.use('/upload-to-oss', async (req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: '仅支持 POST' }))
          return
        }

        if (!accessKeyId || !accessKeySecret || !bucket || !region) {
          res.statusCode = 500
          res.end(JSON.stringify({
            error: 'OSS 环境变量未配置。请在项目根目录创建 .env.local，填写 OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET、OSS_BUCKET、OSS_REGION。'
          }))
          return
        }

        try {
          // 读取请求体
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk)
          }
          const body = Buffer.concat(chunks).toString('utf8')
          const { image } = JSON.parse(body || '{}')
          if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '请求体需包含 base64 图片数据' }))
            return
          }

          // base64 解码
          const match = image.match(/^data:image\/(\w+);base64,(.+)$/)
          if (!match) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'base64 格式不正确' }))
            return
          }
          const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
          const base64Data = match[2]
          const buffer = Buffer.from(base64Data, 'base64')
          const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`

          const objectName = `ai-video-gen/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`

          let publicUrl: string
          const isAccessPoint = endpoint && endpoint.includes('oss-accesspoint')

          if (isAccessPoint) {
            if (!accessPointAlias) {
              throw new Error('使用 OSS 接入点时，需要在 .env.local 中配置 OSS_ACCESS_POINT_ALIAS（接入点别名）')
            }
            // 接入点（Access Point）不被 ali-oss Node.js SDK 原生支持，需用 OSS 签名 V1 手动 PUT
            publicUrl = await putObjectViaAccessPoint({
              endpoint,
              accessPointAlias,
              accessKeyId,
              accessKeySecret,
              objectName,
              buffer,
              contentType,
            })
          } else {
            // 普通 bucket endpoint：直接用 ali-oss SDK
            const OSS = (await import('ali-oss')).default
            const client = new OSS({
              accessKeyId,
              accessKeySecret,
              bucket,
              region,
              endpoint: endpoint || undefined,
              secure: true,
            })
            const result = await client.put(objectName, buffer, {
              headers: { 'x-oss-object-acl': 'public-read' },
            })
            publicUrl = result.url
          }

          res.statusCode = 200
          res.end(JSON.stringify({ url: publicUrl }))
        } catch (e: any) {
          console.error('[upload-to-oss] error:', e)
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message || 'OSS 上传失败' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), proxyFetchPlugin(), uploadToOssPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
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
      '/mulerouter': {
        target: 'https://38gba5w4.mule.page',
        changeOrigin: true,
        secure: false,
        timeout: 120000,
        proxyTimeout: 120000,
        rewrite: (path) => path.replace(/^\/mulerouter/, ''),
      },
    },
  },
})
