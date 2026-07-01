import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

const NODES = 16
const LINKS = [
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,0],
  [0,4],[1,5],[2,6],[3,7],[8,12],[9,13],[10,14],[11,15],[4,8],[5,9],[6,10],[7,11],[0,8],[4,12],
]

export default function LandingGraph({ className = '' }) {
  const svgRef = useRef(null)

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = svgRef.current
    const parent = el.parentElement
    const rect = parent.getBoundingClientRect()
    let width = Math.max(rect.width, 300)
    let height = Math.max(rect.height, 300)

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')

    const linkData = LINKS.map(([s, t]) => ({ source: s, target: t }))
    const nodeData = Array.from({ length: NODES }, (_, i) => ({
      id: i, pulsing: i < 6,
      z: Math.sin((i / NODES) * Math.PI * 2) * 50,
    }))

    const simulation = d3.forceSimulation(nodeData)
      .force('link', d3.forceLink(linkData).distance(140).strength(0.12))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(35))
      .alpha(0.6).alphaDecay(0.008).alphaTarget(0.1).velocityDecay(0.25)

    const link = g.append('g').selectAll('line').data(linkData).join('line')
      .attr('stroke', '#3a3a3a').attr('stroke-width', 1.2).attr('stroke-opacity', 0.35)

    const linkFlow = g.append('g').selectAll('line').data(linkData).join('line')
      .attr('stroke', '#f59e0b').attr('stroke-width', 1.8)
      .attr('stroke-opacity', 0.5).attr('stroke-dasharray', '4 12')
      .attr('stroke-linecap', 'round')

    const node = g.append('g').selectAll('circle').data(nodeData).join('circle')
      .attr('r', d => 7 + d.z / 30)
      .attr('fill', d => d.pulsing ? '#fbbf24' : '#f59e0b')
      .attr('opacity', d => 0.5 + (d.z + 50) / 100 * 0.5)

    if (!prefersReduced) {
      node.filter(d => d.pulsing).each(function () {
        const el = d3.select(this)
        ;(function pulse() {
          el.transition().duration(1800).attr('r', 12).attr('opacity', 0.6)
            .transition().duration(1800).attr('r', d => 7 + d.z / 30).attr('opacity', d => 0.5 + (d.z + 50) / 100 * 0.5)
            .on('end', pulse)
        })()
      })

      let mouseX = null, mouseY = null
      svg.on('mousemove', e => {
        const [mx, my] = d3.pointer(e)
        mouseX = mx; mouseY = my
      })
      svg.on('mouseleave', () => { mouseX = null; mouseY = null })

      const t0 = Date.now()
      simulation.on('tick', () => {
        const dt = (Date.now() - t0) / 1000
        const driftX = Math.sin(dt * 0.15) * 0.18
        const driftY = Math.cos(dt * 0.1) * 0.18
        nodeData.forEach(d => { d.vx += driftX; d.vy += driftY })

        if (mouseX !== null && mouseY !== null) {
          const r = 140
          nodeData.forEach(d => {
            const dx = d.x - mouseX, dy = d.y - mouseY
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < r && dist > 0) {
              const force = (r - dist) / r * 3.5
              d.vx += (dx / dist) * force
              d.vy += (dy / dist) * force
            }
          })
        }

        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
        linkFlow.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
        node.attr('cx', d => d.x).attr('cy', d => d.y)
      })

      d3.timer(elapsed => {
        linkFlow.attr('stroke-dashoffset', -elapsed / 50)
      })

      let flowPhase = 0
      setInterval(() => {
        flowPhase = (flowPhase + 0.03) % (Math.PI * 2)
        linkFlow.attr('stroke-opacity', 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(flowPhase)))
      }, 60)
    }

    function resize() {
      const r = parent.getBoundingClientRect()
      width = Math.max(r.width, 300)
      height = Math.max(r.height, 300)
      simulation.force('center', d3.forceCenter(width / 2, height / 2))
      simulation.alpha(0.3).restart()
    }
    window.addEventListener('resize', resize)

    return () => { simulation.stop(); window.removeEventListener('resize', resize) }
  }, [])

  return <svg ref={svgRef} className={className} />
}
