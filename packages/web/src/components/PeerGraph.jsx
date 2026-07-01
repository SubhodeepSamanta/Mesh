import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

const COLORS = { pending: '#3a3a3a', requested: '#f59e0b', verified: '#22c55e', failed: '#ef4444' }

export default function PeerGraph({ className = '', chunkStates = [], role = null }) {
  const svgRef = useRef(null)
  const simRef = useRef(null)
  const nodeRef = useRef(null)
  const linkRef = useRef(null)
  const infoRef = useRef(null)

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

    const margin = { top: 28, right: 30, bottom: 28, left: 30 }
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
        if (d.id === 'sender') return role === 'sender' ? rightX : leftX
        if (d.id === 'receiver') return role === 'sender' ? leftX : rightX
        const s = chunkStates[d.idx]
        if (s === 'verified') return rightX
        if (s === 'requested') return margin.left + innerW / 2
        return leftX
      }).strength(d => d.id === 'sender' || d.id === 'receiver' ? 4 : 0.08))
      .force('y', d3.forceY(d => d.id === 'sender' || d.id === 'receiver' ? centerY : centerY + (Math.random() - 0.5) * innerH * 0.7).strength(d => d.id === 'sender' || d.id === 'receiver' ? 4 : 0.05))
      .force('charge', d3.forceManyBody().strength(d => d.id === 'sender' || d.id === 'receiver' ? -100 : -15))
      .force('collision', d3.forceCollide(d => d.id === 'sender' || d.id === 'receiver' ? 14 : 5))
      .alpha(0.5).alphaDecay(0.015).alphaTarget(0.05).velocityDecay(0.35)

    const g = svg.append('g')

    const link = g.append('g').selectAll('line').data(allLinks).join('line')
      .attr('stroke', '#2a2a2a').attr('stroke-width', 0.3).attr('stroke-opacity', 0.2)

    const node = g.append('g').selectAll('circle').data(allNodes).join('circle')
      .attr('r', d => d.id === 'sender' || d.id === 'receiver' ? 12 : 5)
      .attr('fill', d => {
        if (d.id === 'sender') return '#f59e0b'
        if (d.id === 'receiver') return '#22c55e'
        return COLORS[d.state] || '#3a3a3a'
      })
      .attr('stroke', d => d.id === 'sender' || d.id === 'receiver' ? 'none' : 'rgba(255,255,255,0.08)')
      .attr('stroke-width', 1)

    const label = g.append('g')
    label.append('text').attr('text-anchor', 'middle').attr('font-family', 'monospace').attr('font-size', '11px').attr('fill', '#6b7280')
      .attr('x', role === 'sender' ? rightX : leftX).attr('y', centerY + 26).text(role === 'sender' ? 'YOU' : 'SENDER')
    label.append('text').attr('text-anchor', 'middle').attr('font-family', 'monospace').attr('font-size', '11px').attr('fill', '#6b7280')
      .attr('x', role === 'sender' ? leftX : rightX).attr('y', centerY + 26).text(role === 'receiver' ? 'YOU' : 'RECEIVER')

    const verified = chunkStates.filter(s => s === 'verified').length
    const totalChunks = chunkStates.length
    if (totalChunks > 0) {
      label.append('text').attr('font-family', 'monospace').attr('font-size', '11px').attr('fill', '#6b7280')
        .attr('x', 14).attr('y', height - 14).text(`${verified}/${totalChunks} verified`)
    }

    if (prefersReduced) {
      sim.stop()
      allNodes.forEach(d => {
        if (d.id === 'sender') { d.x = (role === 'sender' ? rightX : leftX); d.y = centerY }
        else if (d.id === 'receiver') { d.x = (role === 'sender' ? leftX : rightX); d.y = centerY }
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
  }, [role, chunkStates.length])

  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    const nodes = sim.nodes()
    const total = chunkStates.length
    nodes.forEach(d => {
      if (d.idx !== undefined && d.idx < total) d.state = chunkStates[d.idx]
    })
    if (nodeRef.current) {
      nodeRef.current.attr('fill', d => {
        if (d.id === 'sender') return '#f59e0b'
        if (d.id === 'receiver') return '#22c55e'
        return COLORS[d.state] || '#3a3a3a'
      }).attr('r', d => d.id === 'sender' || d.id === 'receiver' ? 12 : 5)
    }
    const verified = chunkStates.filter(s => s === 'verified').length
    if (infoRef.current && total > 0) {
      infoRef.current.selectAll('text').filter(function() {
        return d3.select(this).text().includes('/')
      }).text(`${verified}/${total} verified`)
    }
    sim.alpha(0.3).restart()
  }, [chunkStates, role])

  return <svg ref={svgRef} className={className} />
}
