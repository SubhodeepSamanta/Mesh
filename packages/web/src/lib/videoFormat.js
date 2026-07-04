// Container/codec detection for the opt-in "play while downloading" feature
// (§6). MSE's appendBuffer only works with *fragmented* media (moof+mdat
// segments it can hand off incrementally) — a plain "faststart" MP4 (moov
// moved to the front) is NOT enough; MSE still needs actual movie fragments,
// signaled by an mvex box inside moov. WebM/Matroska doesn't have this
// problem (it's cluster-based and streamable by design), so it never needs
// this check.

const VIDEO_CONTAINERS = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm' }

export function getVideoContainer(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  return VIDEO_CONTAINERS[ext] || null
}

// A broader set purely for "does this look like a video worth offering a
// Play button for at all" — formats outside getVideoContainer() can still
// be played once fully downloaded (browser support permitting), just never
// progressively.
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'ogv'])

export function looksLikeVideo(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  return VIDEO_EXTENSIONS.has(ext)
}

function readBoxHeader(bytes, offset) {
  if (offset + 8 > bytes.length) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  let size = view.getUint32(0, false)
  const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
  let headerSize = 8
  if (size === 1) {
    if (offset + 16 > bytes.length) return null
    const view2 = new DataView(bytes.buffer, bytes.byteOffset + offset, 16)
    const hi = view2.getUint32(8, false)
    const lo = view2.getUint32(12, false)
    size = hi * 2 ** 32 + lo
    headerSize = 16
  }
  return { type, size, headerSize }
}

// Returns 'fragmented' | 'not-fragmented' | 'unknown' (not enough of the
// file's head has arrived yet to tell either way).
export function detectMp4Fragmentation(bytes) {
  let offset = 0
  while (offset < bytes.length) {
    const box = readBoxHeader(bytes, offset)
    if (!box) return 'unknown'
    if (box.type === 'moov') {
      const childrenStart = offset + box.headerSize
      const childrenEnd = box.size === 0 ? bytes.length : offset + box.size
      if (box.size !== 0 && childrenEnd > bytes.length) return 'unknown' // moov itself not fully downloaded
      let childOffset = childrenStart
      while (childOffset < childrenEnd) {
        const child = readBoxHeader(bytes, childOffset)
        if (!child) return 'unknown'
        if (child.type === 'mvex') return 'fragmented'
        if (child.size === 0) break
        childOffset += child.size
      }
      return 'not-fragmented'
    }
    if (box.size === 0) return 'unknown' // box extends to EOF — can't skip past it
    offset += box.size
  }
  return 'unknown'
}

const MP4_CODEC_CANDIDATES = [
  'video/mp4; codecs="avc1.64001E, mp4a.40.2"',
  'video/mp4; codecs="avc1.4D401E, mp4a.40.2"',
  'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  'video/mp4; codecs="avc1.42E01E"',
  'video/mp4; codecs="hev1.1.6.L93.B0"',
]
const WEBM_CODEC_CANDIDATES = [
  'video/webm; codecs="vp9,opus"',
  'video/webm; codecs="vp8,vorbis"',
  'video/webm; codecs="vp8"',
]

// We can't know the encoder's exact profile/level without much deeper
// parsing than is worth it here, so this tries a handful of common,
// broadly-compatible codec strings and lets the browser's own
// isTypeSupported be the judge — good enough for "can this browser take a
// stab at MSE playback of this container" rather than exact codec matching.
export function pickSupportedMimeCodec(container, mediaSourceImpl) {
  const MS = mediaSourceImpl || (typeof MediaSource !== 'undefined' ? MediaSource : null)
  if (!MS || typeof MS.isTypeSupported !== 'function') return null
  const candidates = container === 'video/webm' ? WEBM_CODEC_CANDIDATES : MP4_CODEC_CANDIDATES
  for (const c of candidates) {
    try { if (MS.isTypeSupported(c)) return c } catch { /* keep trying */ }
  }
  return null
}
