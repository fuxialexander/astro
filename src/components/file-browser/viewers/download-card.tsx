/**
 * DownloadCard — Fallback card for unsupported file types
 *
 * Shows file icon, name, and a download button.
 */

import { useMemo } from "react"
import {
  FileText,
  FileSpreadsheet,
  FileArchive,
  FileVideo,
  FileAudio,
  File,
  Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { buildContentUrl } from "../file-type-utils"
import { cn } from "@/lib/utils"

interface DownloadCardProps {
  machineId: string
  filePath: string
  className?: string
}

const DOWNLOAD_ICON_MAP: Record<string, typeof File> = {
  doc: FileText, docx: FileText, odt: FileText, rtf: FileText,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, ods: FileSpreadsheet,
  ppt: FileText, pptx: FileText, odp: FileText,
  zip: FileArchive, tar: FileArchive, gz: FileArchive, rar: FileArchive, "7z": FileArchive,
  mp4: FileVideo, mov: FileVideo, avi: FileVideo, mkv: FileVideo, webm: FileVideo,
  mp3: FileAudio, wav: FileAudio, flac: FileAudio, ogg: FileAudio, aac: FileAudio,
}

export function DownloadCard({ machineId, filePath, className }: DownloadCardProps) {
  const filename = filePath.split("/").pop() ?? "file"
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const extDisplay = ext.toUpperCase()
  const Icon = useMemo(() => DOWNLOAD_ICON_MAP[ext] ?? File, [ext])
  const downloadUrl = buildContentUrl(machineId, filePath, true)

  const handleDownload = () => {
    // Create a temporary anchor to trigger browser download
    const a = document.createElement("a")
    a.href = downloadUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className={cn("flex items-center justify-center h-full p-6", className)}>
      <div className="flex flex-col items-center gap-4 max-w-[240px] text-center">
        <div className="p-4 rounded-xl bg-muted/50">
          <Icon className="h-12 w-12 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium truncate max-w-[200px]" title={filename}>
            {filename}
          </p>
          {extDisplay && (
            <p className="text-xs text-muted-foreground">{extDisplay} file</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download
        </Button>
      </div>
    </div>
  )
}
