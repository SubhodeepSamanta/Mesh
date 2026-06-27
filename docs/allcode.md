# All Code Snapshot

Generated from: Mesh Root Project

Excluded: node_modules, .git, package-lock.json, .env

## File List

- .env.example
- .gitignore
- docker-compose.yml
- docs/phase1.md
- docs/phases.md
- package.json
- packages/cli/package.json
- packages/cli/src/commands/receive.js
- packages/cli/src/commands/send.js
- packages/cli/src/index.js
- packages/cli/src/ui/TransferTUI.jsx
- packages/engine/package.json
- packages/engine/src/chunker.js
- packages/engine/src/crypto.js
- packages/engine/src/dht.js
- packages/engine/src/index.js
- packages/engine/src/peer.js
- packages/engine/src/protocol.js
- packages/engine/src/swarm.js
- packages/engine/src/transfer.js
- packages/engine/test/chunker.test.js
- packages/engine/test/protocol.test.js
- packages/signaling/Dockerfile
- packages/signaling/package.json
- packages/signaling/src/metrics.js
- packages/signaling/src/server.js
- packages/web/.gitignore
- packages/web/eslint.config.js
- packages/web/index.html
- packages/web/package.json
- packages/web/public/favicon.svg
- packages/web/public/icons.svg
- packages/web/README.md
- packages/web/src/App.css
- packages/web/src/App.jsx
- packages/web/src/assets/hero.png
- packages/web/src/assets/react.svg
- packages/web/src/assets/vite.svg
- packages/web/src/index.css
- packages/web/src/main.jsx
- packages/web/vite.config.js

## Contents

### .env.example

```text
PORT=8080
NODE_ENV=development
VITE_SIGNALING_URL=ws://localhost:8080
```

### .gitignore

```text
node_modules/
dist/
.env
*.log
.DS_Store
received/
testfile.bin
```

### docker-compose.yml

```text
version: '3.8'
services:
  signaling:
    build: ./packages/signaling
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
    restart: unless-stopped
```

### docs/phase1.md

```text

```

### docs/phases.md

```text

```

### package.json

```text
{
  "name": "mesh",
  "version": "1.0.0",
  "description": "Decentralised P2P file transfer platform",
  "private": true,
  "workspaces": [
    "packages/engine",
    "packages/signaling",
    "packages/web",
    "packages/cli"
  ],
  "scripts": {
    "dev:signaling": "npm run dev --workspace=packages/signaling",
    "dev:web": "npm run dev --workspace=packages/web",
    "test": "npm run test --workspace=packages/engine"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/subhodeepsamanta/mesh.git"
  },
  "author": "Subhodeep Samanta",
  "license": "ISC"
}
```

### packages/cli/package.json

```text
{
  "name": "@mesh/cli",
  "version": "1.0.0",
  "description": "Mesh CLI for sending and receiving files",
  "main": "src/index.js",
  "type": "module",
  "bin": {
    "mesh": "src/index.js"
  },
  "scripts": {
    "dev": "node src/index.js"
  },
  "license": "ISC",
  "dependencies": {
    "commander": "^15.0.0",
    "ink": "^7.1.0"
  }
}
```

### packages/cli/src/commands/receive.js

```text
export function receiveCommand() {}
```

### packages/cli/src/commands/send.js

```text
export function sendCommand() {}
```

### packages/cli/src/index.js

```text
#!/usr/bin/env node
console.log('Mesh CLI');
```

### packages/cli/src/ui/TransferTUI.jsx

```text
export function TransferTUI() { return null; }
```

### packages/engine/package.json

```text
{
  "name": "@mesh/engine",
  "version": "1.0.0",
  "description": "Core P2P engine shared by web and cli",
  "main": "src/index.js",
  "type": "module",
  "scripts": {
    "test": "node --test test/**/*.test.js"
  },
  "license": "ISC"
}
```

### packages/engine/src/chunker.js

```text
export const PROTOCOL_VERSION = '1.0.0';
```

### packages/engine/src/crypto.js

```text
export const CIPHER = 'aes-256-gcm';
```

### packages/engine/src/dht.js

```text
export const DHT_K = 20;
```

### packages/engine/src/index.js

```text
export * from './protocol.js';
export * from './chunker.js';
export * from './crypto.js';
```

### packages/engine/src/peer.js

```text
export const PEER_TIMEOUT_MS = 30000;
```

### packages/engine/src/protocol.js

```text
export const PROTOCOL_VERSION = '1.0.0';
```

### packages/engine/src/swarm.js

```text
export const PIPELINE_SIZE = 16;
```

### packages/engine/src/transfer.js

```text
export const TRANSFER_VERSION = '1.0.0';
```

### packages/engine/test/chunker.test.js

```text

```

### packages/engine/test/protocol.test.js

```text

```

### packages/signaling/Dockerfile

```text

```

### packages/signaling/package.json

```text
{
  "name": "@mesh/signaling",
  "version": "1.0.0",
  "description": "WebSocket signaling server",
  "main": "src/server.js",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js"
  },
  "license": "ISC",
  "dependencies": {
    "ws": "^8.21.0"
  }
}
```

### packages/signaling/src/metrics.js

```text
export const metrics = { totalRooms: 0, totalPeers: 0 };
```

### packages/signaling/src/server.js

```text
const PORT = process.env.PORT || 8080;
console.log(`Signaling server starting on port ${PORT}`);
```

### packages/web/.gitignore

```text
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
```

### packages/web/eslint.config.js

```text
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
```

### packages/web/index.html

```text
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>web</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### packages/web/package.json

```text
{
  "name": "web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "d3": "^7.9.0",
    "framer-motion": "^12.42.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-dropzone": "^15.0.0",
    "recharts": "^3.9.0",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    "eslint": "^10.5.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.3",
    "globals": "^17.6.0",
    "vite": "^8.1.0"
  }
}
```

### packages/web/public/favicon.svg

Binary file omitted from markdown snapshot (9522 bytes).

### packages/web/public/icons.svg

Binary file omitted from markdown snapshot (5031 bytes).

### packages/web/README.md

```text
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
```

### packages/web/src/App.css

```text
.counter {
  font-size: 16px;
  padding: 5px 10px;
  border-radius: 5px;
  color: var(--accent);
  background: var(--accent-bg);
  border: 2px solid transparent;
  transition: border-color 0.3s;
  margin-bottom: 24px;

  &:hover {
    border-color: var(--accent-border);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.hero {
  position: relative;

  .base,
  .framework,
  .vite {
    inset-inline: 0;
    margin: 0 auto;
  }

  .base {
    width: 170px;
    position: relative;
    z-index: 0;
  }

  .framework,
  .vite {
    position: absolute;
  }

  .framework {
    z-index: 1;
    top: 34px;
    height: 28px;
    transform: perspective(2000px) rotateZ(300deg) rotateX(44deg) rotateY(39deg)
      scale(1.4);
  }

  .vite {
    z-index: 0;
    top: 107px;
    height: 26px;
    width: auto;
    transform: perspective(2000px) rotateZ(300deg) rotateX(40deg) rotateY(39deg)
      scale(0.8);
  }
}

#center {
  display: flex;
  flex-direction: column;
  gap: 25px;
  place-content: center;
  place-items: center;
  flex-grow: 1;

  @media (max-width: 1024px) {
    padding: 32px 20px 24px;
    gap: 18px;
  }
}

#next-steps {
  display: flex;
  border-top: 1px solid var(--border);
  text-align: left;

  & > div {
    flex: 1 1 0;
    padding: 32px;
    @media (max-width: 1024px) {
      padding: 24px 20px;
    }
  }

  .icon {
    margin-bottom: 16px;
    width: 22px;
    height: 22px;
  }

  @media (max-width: 1024px) {
    flex-direction: column;
    text-align: center;
  }
}

#docs {
  border-right: 1px solid var(--border);

  @media (max-width: 1024px) {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}

#next-steps ul {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 8px;
  margin: 32px 0 0;

  .logo {
    height: 18px;
  }

  a {
    color: var(--text-h);
    font-size: 16px;
    border-radius: 6px;
    background: var(--social-bg);
    display: flex;
    padding: 6px 12px;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    transition: box-shadow 0.3s;

    &:hover {
      box-shadow: var(--shadow);
    }
    .button-icon {
      height: 18px;
      width: 18px;
    }
  }

  @media (max-width: 1024px) {
    margin-top: 20px;
    flex-wrap: wrap;
    justify-content: center;

    li {
      flex: 1 1 calc(50% - 8px);
    }

    a {
      width: 100%;
      justify-content: center;
      box-sizing: border-box;
    }
  }
}

#spacer {
  height: 88px;
  border-top: 1px solid var(--border);
  @media (max-width: 1024px) {
    height: 48px;
  }
}

.ticks {
  position: relative;
  width: 100%;

  &::before,
  &::after {
    content: '';
    position: absolute;
    top: -4.5px;
    border: 5px solid transparent;
  }

  &::before {
    left: 0;
    border-left-color: var(--border);
  }
  &::after {
    right: 0;
    border-right-color: var(--border);
  }
}
```

### packages/web/src/App.jsx

```text
import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.jsx</code> and save to test <code>HMR</code>
          </p>
        </div>
        <button
          type="button"
          className="counter"
          onClick={() => setCount((count) => count + 1)}
        >
          Count is {count}
        </button>
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul>
            <li>
              <a href="https://github.com/vitejs/vite" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://chat.vite.dev/" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/vite_js" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/vite.dev" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default App
```

### packages/web/src/assets/hero.png

Binary file omitted from markdown snapshot (13057 bytes).

### packages/web/src/assets/react.svg

Binary file omitted from markdown snapshot (4126 bytes).

### packages/web/src/assets/vite.svg

Binary file omitted from markdown snapshot (8709 bytes).

### packages/web/src/index.css

```text
:root {
  --text: #6b6375;
  --text-h: #08060d;
  --bg: #fff;
  --border: #e5e4e7;
  --code-bg: #f4f3ec;
  --accent: #aa3bff;
  --accent-bg: rgba(170, 59, 255, 0.1);
  --accent-border: rgba(170, 59, 255, 0.5);
  --social-bg: rgba(244, 243, 236, 0.5);
  --shadow:
    rgba(0, 0, 0, 0.1) 0 10px 15px -3px, rgba(0, 0, 0, 0.05) 0 4px 6px -2px;

  --sans: system-ui, 'Segoe UI', Roboto, sans-serif;
  --heading: system-ui, 'Segoe UI', Roboto, sans-serif;
  --mono: ui-monospace, Consolas, monospace;

  font: 18px/145% var(--sans);
  letter-spacing: 0.18px;
  color-scheme: light dark;
  color: var(--text);
  background: var(--bg);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  @media (max-width: 1024px) {
    font-size: 16px;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --text: #9ca3af;
    --text-h: #f3f4f6;
    --bg: #16171d;
    --border: #2e303a;
    --code-bg: #1f2028;
    --accent: #c084fc;
    --accent-bg: rgba(192, 132, 252, 0.15);
    --accent-border: rgba(192, 132, 252, 0.5);
    --social-bg: rgba(47, 48, 58, 0.5);
    --shadow:
      rgba(0, 0, 0, 0.4) 0 10px 15px -3px, rgba(0, 0, 0, 0.25) 0 4px 6px -2px;
  }

  #social .button-icon {
    filter: invert(1) brightness(2);
  }
}

body {
  margin: 0;
}

#root {
  width: 1126px;
  max-width: 100%;
  margin: 0 auto;
  text-align: center;
  border-inline: 1px solid var(--border);
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

h1,
h2 {
  font-family: var(--heading);
  font-weight: 500;
  color: var(--text-h);
}

h1 {
  font-size: 56px;
  letter-spacing: -1.68px;
  margin: 32px 0;
  @media (max-width: 1024px) {
    font-size: 36px;
    margin: 20px 0;
  }
}
h2 {
  font-size: 24px;
  line-height: 118%;
  letter-spacing: -0.24px;
  margin: 0 0 8px;
  @media (max-width: 1024px) {
    font-size: 20px;
  }
}
p {
  margin: 0;
}

code,
.counter {
  font-family: var(--mono);
  display: inline-flex;
  border-radius: 4px;
  color: var(--text-h);
}

code {
  font-size: 15px;
  line-height: 135%;
  padding: 4px 8px;
  background: var(--code-bg);
}
```

### packages/web/src/main.jsx

```text
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

### packages/web/vite.config.js

```text
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
```

