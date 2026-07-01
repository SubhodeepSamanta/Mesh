export default function Card({ className = '', children }) {
  return (
    <div
      className={`rounded-2xl border border-black/5 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-white/[0.03] ${className}`}
    >
      {children}
    </div>
  )
}