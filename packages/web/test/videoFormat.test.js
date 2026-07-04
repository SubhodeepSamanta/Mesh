import { describe, it, expect } from 'vitest'
import { getVideoContainer, looksLikeVideo, detectMp4Fragmentation, pickSupportedMimeCodec } from '../src/lib/videoFormat.js'

function box(type, payload = new Uint8Array(0)) {
  const size = 8 + payload.length
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, size, false)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  return out
}

function concat(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

describe('getVideoContainer / looksLikeVideo', () => {
  it('maps common video extensions to MSE-relevant containers', () => {
    expect(getVideoContainer('movie.mp4')).toBe('video/mp4')
    expect(getVideoContainer('clip.m4v')).toBe('video/mp4')
    expect(getVideoContainer('clip.webm')).toBe('video/webm')
    expect(getVideoContainer('notes.txt')).toBeNull()
  })

  it('recognizes a broader set of extensions as "looks like a video"', () => {
    expect(looksLikeVideo('movie.mkv')).toBe(true)
    expect(looksLikeVideo('movie.mov')).toBe(true)
    expect(looksLikeVideo('archive.zip')).toBe(false)
  })
})

describe('detectMp4Fragmentation', () => {
  it('detects a fragmented MP4 (moov containing mvex)', () => {
    const mvex = box('mvex', new Uint8Array(4))
    const moov = box('moov', mvex)
    const ftyp = box('ftyp', new Uint8Array(8))
    const bytes = concat(ftyp, moov)
    expect(detectMp4Fragmentation(bytes)).toBe('fragmented')
  })

  it('detects a non-fragmented MP4 (moov without mvex, faststart-style)', () => {
    const trak = box('trak', new Uint8Array(16))
    const moov = box('moov', trak)
    const ftyp = box('ftyp', new Uint8Array(8))
    const bytes = concat(ftyp, moov)
    expect(detectMp4Fragmentation(bytes)).toBe('not-fragmented')
  })

  it('returns unknown when moov has not fully arrived yet', () => {
    const trak = box('trak', new Uint8Array(64))
    const moov = box('moov', trak)
    const ftyp = box('ftyp', new Uint8Array(8))
    const full = concat(ftyp, moov)
    // Only the first half of the file has arrived — moov is truncated.
    const truncated = full.slice(0, ftyp.length + 10)
    expect(detectMp4Fragmentation(truncated)).toBe('unknown')
  })

  it('returns unknown when mdat arrives before moov and moov has not arrived yet', () => {
    const ftyp = box('ftyp', new Uint8Array(8))
    const mdat = box('mdat', new Uint8Array(1000)) // large payload, moov is somewhere after this
    const bytes = concat(ftyp, mdat).slice(0, ftyp.length + 20) // only a sliver of mdat has arrived
    expect(detectMp4Fragmentation(bytes)).toBe('unknown')
  })

  it('returns unknown for an empty/garbage prefix', () => {
    expect(detectMp4Fragmentation(new Uint8Array(4))).toBe('unknown')
  })
})

describe('pickSupportedMimeCodec', () => {
  it('returns the first mp4 candidate the (fake) MediaSource reports as supported', () => {
    const fakeMediaSource = {
      isTypeSupported: (s) => s === 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    }
    expect(pickSupportedMimeCodec('video/mp4', fakeMediaSource)).toBe('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')
  })

  it('returns null when nothing is supported', () => {
    const fakeMediaSource = { isTypeSupported: () => false }
    expect(pickSupportedMimeCodec('video/mp4', fakeMediaSource)).toBeNull()
  })

  it('returns null when there is no MediaSource implementation at all', () => {
    expect(pickSupportedMimeCodec('video/mp4', null)).toBeNull()
  })

  it('picks from the webm candidate list for webm containers', () => {
    const fakeMediaSource = { isTypeSupported: (s) => s === 'video/webm; codecs="vp8"' }
    expect(pickSupportedMimeCodec('video/webm', fakeMediaSource)).toBe('video/webm; codecs="vp8"')
  })
})
