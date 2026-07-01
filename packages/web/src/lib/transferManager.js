export const transferManager = {
  swarm: null,
  transports: new Map(),
  chunks: [],
  fileRef: null,
  indexRef: null,
  servedRef: new Set(),
  downloadGuard: false,

  reset() {
    this.swarm = null
    this.transports.clear()
    this.chunks = []
    this.fileRef = null
    this.indexRef = null
    this.servedRef = new Set()
    this.downloadGuard = false
  },
}
