export default function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
