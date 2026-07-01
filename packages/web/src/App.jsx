import { Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Layout from './components/layout/Layout.jsx'
import Landing from './pages/Landing.jsx'
import Send from './pages/Send.jsx'
import Receive from './pages/Receive.jsx'
import Dashboard from './pages/Dashboard.jsx'
import History from './pages/History.jsx'
import NotFound from './pages/NotFound.jsx'
import { useUIStore } from './store/useUIStore.js'

function AnimatedPage({ children }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.div>
  )
}

function App() {
  const initTheme = useUIStore((s) => s.initTheme)
  const location = useLocation()

  useEffect(() => { initTheme() }, [initTheme])

  return (
    <Layout>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<AnimatedPage><Landing /></AnimatedPage>} />
          <Route path="/send" element={<AnimatedPage><Send /></AnimatedPage>} />
          <Route path="/receive" element={<AnimatedPage><Receive /></AnimatedPage>} />
          <Route path="/dashboard" element={<AnimatedPage><Dashboard /></AnimatedPage>} />
          <Route path="/history" element={<AnimatedPage><History /></AnimatedPage>} />
          <Route path="*" element={<AnimatedPage><NotFound /></AnimatedPage>} />
        </Routes>
      </AnimatePresence>
    </Layout>
  )
}

export default App
