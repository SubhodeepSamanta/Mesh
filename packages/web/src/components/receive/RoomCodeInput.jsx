import { useState } from 'react'
import Button from '../shared/Button.jsx'

export default function RoomCodeInput({ onJoin, joining, defaultValue = '' }) {
  const [code, setCode] = useState(defaultValue)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (code.trim().length === 6) onJoin(code.trim().toUpperCase())
      }}
      className="flex flex-col items-center gap-4"
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
        placeholder="ROOMCODE"
        className="w-64 rounded-xl border border-black/10 bg-transparent px-4 py-3 text-center font-mono text-2xl tracking-[0.2em] outline-none focus:border-brand-500 dark:border-white/10"
      />
      <Button type="submit" disabled={code.length !== 6 || joining}>
        {joining ? 'Joining…' : 'Join'}
      </Button>
    </form>
  )
}