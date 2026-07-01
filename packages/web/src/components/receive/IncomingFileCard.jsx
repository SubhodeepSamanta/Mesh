import { formatBytes } from '../../lib/format.js'
import Card from '../shared/Card.jsx'

export default function IncomingFileCard({ fileMeta }) {
  if (!fileMeta) return null
  return (
    <Card className="w-full max-w-sm text-center">
      <p className="text-sm text-black/50 dark:text-white/50">Incoming file</p>
      <p className="mt-1 truncate text-lg font-medium">{fileMeta.fileName}</p>
      <p className="mt-1 text-black/60 dark:text-white/60">{formatBytes(fileMeta.fileSize)}</p>
    </Card>
  )
}