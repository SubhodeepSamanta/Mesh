import Header from './Header.jsx'

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
      <Header />
      <main className="flex-1">{children}</main>
    </div>
  )
}
