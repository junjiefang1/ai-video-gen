import { useRef } from 'react'
import { BatchTaskDefinition } from '@/lib/batch-types'
import { parseUploadedFile } from '@/lib/batch-parser'
import { Upload } from 'lucide-react'

interface FileUploadInputProps {
  onLoad: (tasks: BatchTaskDefinition[]) => void
  disabled: boolean
}

export function FileUploadInput({ onLoad, disabled }: FileUploadInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    const text = await file.text()
    const result = parseUploadedFile(text, file.name)

    if (result.errors.length > 0) {
      console.warn('解析错误:', result.errors)
    }

    if (result.valid.length > 0) {
      onLoad(result.valid)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-3">
      <div
        className="upload-zone rounded-lg p-6 text-center cursor-pointer relative"
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.json"
          onChange={handleChange}
          disabled={disabled}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-2">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">上传 CSV 或 JSON 任务文件</p>
          <p className="text-xs text-muted-foreground">每行/项包含: prompt, mode, resolution, duration</p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p className="font-medium">JSON 格式示例:</p>
        <pre className="bg-secondary/50 rounded p-2 overflow-x-auto text-[10px]">
{`[
  {"prompt": "描述...", "mode": "text-to-video", "resolution": "720p", "duration": 5}
]`}
        </pre>
      </div>
    </div>
  )
}
