import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'

export default function DropZone({ onFileReady }) {
  const [indexing, setIndexing] = useState(false)

  const onDrop = useCallback(async (accepted) => {
    const file = accepted[0]
    if (!file) return
    setIndexing(true)
    const { indexFile } = await import('../../lib/fileChunker.js')
    const fileIndex = await indexFile(file)
    setIndexing(false)
    onFileReady(file, fileIndex)
  }, [onFileReady])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: false })

  return (
    <div
      {...getRootProps()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-16 text-center transition ${
        isDragActive
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
          : 'border-black/15 dark:border-white/15'
      }`}
    >
      <input {...getInputProps()} />
      {indexing ? (
        <p className="text-black/60 dark:text-white/60">Indexing file…</p>
      ) : isDragActive ? (
        <p className="font-medium text-brand-500">Drop it here</p>
      ) : (
        <>
          <p className="font-medium">Drag a file here, or click to browse</p>
          <p className="mt-1 text-sm text-black/50 dark:text-white/50">Any file, any size</p>
        </>
      )}
    </div>
  )
}