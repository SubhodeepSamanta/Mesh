import React, { useState, useEffect } from 'react';
import { render, Box, Text, Newline } from 'ink';

const h = React.createElement;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function ProgressBar({ percent, width = 30 }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((width * clamped) / 100);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return h(Text, null, `[${bar}] ${clamped.toFixed(1)}%`);
}

// Deliberately renders exactly once (no ticking timers): any re-render makes
// the terminal redraw the box, which breaks text selection while the user is
// trying to copy the share code.
function SendApp({ summary }) {
  return h(
    Box,
    { flexDirection: 'column', paddingX: 1, borderStyle: 'round', borderColor: 'cyan' },
    h(Text, { bold: true, color: 'cyan' }, 'mesh send'),
    h(Text, null, `${summary.fileName}  ${formatBytes(summary.fileSize)}  ${summary.totalChunks} chunks`),
    h(Text, { dimColor: true }, `Connectivity: ${summary.connectivity}${summary.turnConfigured ? ' + TURN relay' : ''}`),
    h(Newline),
    h(Text, null, 'Share code:'),
    h(Text, { bold: true, color: 'green' }, summary.shareCodeFormatted),
    h(Newline),
    h(Text, { dimColor: true }, 'Seeding — waiting for receivers. Ctrl+C to stop.'),
    h(Text, { dimColor: true }, `Receiver command: mesh receive ${summary.shareCode}`)
  );
}

function ReceiveApp({ fileLabel, swarm }) {
  const [progress, setProgress] = useState({ verified: 0, total: swarm.totalChunks || 0 });
  const [peers, setPeers] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [retrying, setRetrying] = useState(null);
  const [startTime] = useState(Date.now());
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onChunkVerified = ({ verified, total }) => { setProgress({ verified, total }); setRetrying(null); };
    const onPeerConnected = ({ peerId, tier }) => setPeers((prev) => [...prev, { peerId, tier }]);
    const onWarnings = (list) => setWarnings((prev) => [...prev, ...list]);
    const onRetrying = (info) => setRetrying(info);
    const onComplete = () => setDone(true);

    swarm.on('chunkVerified', onChunkVerified);
    swarm.on('peerConnected', onPeerConnected);
    swarm.on('connectionWarnings', onWarnings);
    swarm.on('retrying', onRetrying);
    swarm.on('complete', onComplete);

    return () => {
      swarm.removeListener('chunkVerified', onChunkVerified);
      swarm.removeListener('peerConnected', onPeerConnected);
      swarm.removeListener('connectionWarnings', onWarnings);
      swarm.removeListener('retrying', onRetrying);
      swarm.removeListener('complete', onComplete);
    };
  }, [swarm]);

  const percent = progress.total > 0 ? (progress.verified / progress.total) * 100 : 0;
  const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
  const speed = (progress.verified * (swarm.chunkSize || 0)) / elapsedSec;

  const children = [
    h(Text, { bold: true, color: done ? 'green' : 'cyan', key: 'title' }, done ? 'mesh receive — complete' : 'mesh receive'),
    h(Text, { key: 'file' }, fileLabel),
    h(ProgressBar, { percent, key: 'bar' }),
    h(Text, { dimColor: true, key: 'stats' }, `${progress.verified}/${progress.total} chunks — ${formatBytes(speed)}/s`),
  ];

  if (peers.length > 0) {
    children.push(
      h(
        Box,
        { flexDirection: 'column', marginTop: 1, key: 'peers' },
        h(Text, { dimColor: true, key: 'peers-label' }, 'Peers:'),
        ...peers.map((p, i) => h(Text, { key: `peer-${i}` }, `  ${p.peerId} (${p.tier})`))
      )
    );
  }

  if (retrying && !done) {
    children.push(
      h(Text, { color: 'yellow', key: 'retrying' }, `Connection lost — reconnecting (attempt ${retrying.attempt}, ${retrying.verified}/${retrying.total} chunks kept)...`)
    );
  }

  // Collapsed on purpose: unreachable peers are routine (stale DHT listings
  // from stopped seeders) and the transfer already succeeded via the peers
  // shown above. Total failure surfaces the full per-peer detail as an error.
  if (warnings.length > 0) {
    children.push(
      h(Text, { dimColor: true, key: 'warnings' }, `Skipped ${warnings.length} unreachable peer listing(s)`)
    );
  }

  return h(Box, { flexDirection: 'column', paddingX: 1, borderStyle: 'round', borderColor: done ? 'green' : 'cyan' }, ...children);
}

export function renderSendTUI(summary) {
  return render(h(SendApp, { summary }));
}

export function renderReceiveTUI({ fileLabel, swarm }) {
  return render(h(ReceiveApp, { fileLabel, swarm }));
}
