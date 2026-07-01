import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

const COLORS = { pending: 'var(--border-light)', requested: 'var(--accent)', verified: 'var(--success)', failed: 'var(--error)' }

export default function PeerGraph({ className = '', chunkStates = [], role = null, peerStats = [], seeding = false }) {
  const svgRef = useRef(null)
  const simRef = useRef(null)
  const nodeRef = useRef(null)
  const linkRef = useRef(null)
  const infoRef = useRef(null)

  const allVerified = chunkStates.length > 0 && chunkStates.every(s => s === 'verified')
  const youLabel = role === 'sender' ? 'YOU (Seeder)' : 'YOU (Leecher)'

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = svgRef.current
    const parent = el.parentElement
    const rect = parent.getBoundingClientRect()
    const width = Math.max(rect.width, 300)
    const height = Math.max(rect.height, 200)

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const margin = { top: 34, right: 30, bottom: 34, left: 30 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom
    const centerY = margin.top + innerH / 2
    const leftX = margin.left + innerW * 0.12
    const rightX = margin.left + innerW * 0.88

    const total = Math.max(chunkStates.length, 10)
    const displayCount = Math.min(total, 40)
    const chunkNodes = Array.from({ length: displayCount }, (_, i) => {
      const idx = total > displayCount ? Math.floor((i / displayCount) * total) : i
      return { id: `c${i}`, idx, state: chunkStates[idx] || 'pending' }
    })

    const senderNode = { id: 'sender' }
    const receiverNode = { id: 'receiver' }
    const allNodes = [senderNode, receiverNode, ...chunkNodes]
    const allLinks = chunkNodes.flatMap(d => [{ source: 'sender', target: d.id }, { source: d.id, target: 'receiver' }])

    const sim = d3.forceSimulation(allNodes)
      .force('x', d3.forceX(d => {
        if (d.id === 'sender') return leftX
        if (d.id === 'receiver') return rightX
        const s = chunkStates[d.idx]
        if (allVerified || s === 'verified') return rightX
        if (s === 'requested') return margin.left + innerW / 2
        return leftX
      }).strength(d => d.id === 'sender' || d.id === 'receiver' ? 4 : 0.08))
      .force('y', d3.forceY(d => d.id === 'sender' || d.id === 'receiver' ? centerY : centerY + (Math.random() - 0.5) * innerH * 0.7).strength(d => d.id === 'sender' || d.id === 'receiver' ? 4 : 0.05))
      .force('charge', d3.forceManyBody().strength(d => d.id === 'sender' || d.id === 'receiver' ? -100 : -15))
      .force('collision', d3.forceCollide(d => d.id === 'sender' || d.id === 'receiver' ? 14 : 5))
      .alpha(0.5).alphaDecay(0.015).alphaTarget(allVerified ? 0 : 0.05).velocityDecay(0.35)

    const g = svg.append('g')

    const link = g.append('g').selectAll('line').data(allLinks).join('line')
      .attr('stroke', 'var(--border-light)').attr('stroke-width', 0.5).attr('stroke-opacity', 0.5)

    const node = g.append('g').selectAll('circle').data(allNodes).join('circle')
      .attr('r', d => d.id === 'sender' || d.id === 'receiver' ? 12 : 5)
      .attr('fill', d => {
        if (d.id === 'sender') return 'var(--accent)'
        if (d.id === 'receiver') return 'var(--success)'
        return COLORS[d.state] || 'var(--border-light)'
      })
      .attr('stroke', d => d.id === 'sender' || d.id === 'receiver' ? 'none' : 'var(--bg-primary)')
      .attr('stroke-width', 1)

    const label = g.append('g')
    const txt = (x, y, text, color = 'var(--txt-secondary)', bold = false) => {
      const t = label.append('text').attr('text-anchor', 'middle').attr('font-family', 'var(--font-sans)').attr('font-size', '10px').attr('fill', color).attr('x', x).attr('y', y)
      if (bold) t.attr('font-weight', 'bold')
      t.text(text)
    }

    txt(leftX, centerY + 20, role === 'sender' ? youLabel : 'SEEDER', role === 'sender' ? 'var(--accent)' : 'var(--txt-secondary)', role === 'sender')
    txt(rightX, centerY + 20, role === 'receiver' ? youLabel : 'LEECHER', role === 'receiver' ? 'var(--success)' : 'var(--txt-secondary)', role === 'receiver')
    if (seeding) {
      txt(rightX, centerY + 32, '+ SEEDING', 'var(--accent)', false)
    }

    const verified = chunkStates.filter(s => s === 'verified').length
    const totalChunks = chunkStates.length
    if (totalChunks > 0) {
      txt(14, height - 14, allVerified ? '✓ Complete' : `${verified}/${totalChunks}`)
    }

    if (prefersReduced) {
      sim.stop()
      allNodes.forEach(d => {
        if (d.id === 'sender') { d.x = leftX; d.y = centerY }
        else if (d.id === 'receiver') { d.x = rightX; d.y = centerY }
        else { d.x = leftX + Math.random() * innerW * 0.7; d.y = centerY + (Math.random() - 0.5) * innerH * 0.5 }
      })
      sim.tick(50)
    }

    sim.on('tick', () => {
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      node.attr('cx', d => d.x).attr('cy', d => d.y)
    })

    simRef.current = sim
    nodeRef.current = node
    linkRef.current = link
    infoRef.current = label

    return () => { sim.stop() }
  }, [role, chunkStates.length, allVerified, seeding])

  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    const nodes = sim.nodes()
    const total = chunkStates.length
    nodes.forEach(d => {
      if (d.idx !== undefined && d.idx < total) d.state = chunkStates[d.idx]
    })
    if (nodeRef.current) {
      nodeRef.current.transition().duration(400).attr('fill', d => {
        if (d.id === 'sender') return 'var(--accent)'
        if (d.id === 'receiver') return 'var(--success)'
        return COLORS[d.state] || 'var(--border-light)'
      })
    }
    const verified = chunkStates.filter(s => s === 'verified').length
    if (infoRef.current && total > 0) {
      infoRef.current.selectAll('text').filter(function() {
        return d3.select(this).text().includes('/')
      }).text(allVerified ? '✓ Complete' : `${verified}/${total}`)
    }
    sim.alpha(allVerified ? 0.8 : 0.5).restart()
  }, [chunkStates, role, allVerified])

  return <svg ref={svgRef} className={className} />
}
