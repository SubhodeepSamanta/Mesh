export default function ProgressBar({ percent }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
      <div
        className="h-full rounded-full bg-brand-500 transition-all duration-300"
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  )
}