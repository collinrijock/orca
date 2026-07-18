const { spawn } = require('node:child_process')
const readline = require('node:readline')

const [role, label, nonce] = process.argv.slice(2)

if (!role || !label || !nonce) {
  throw new Error('Usage: daemon-generation-marker <session|control> <label> <nonce>')
}

let descendant = null
let controlTimer = null
if (role === 'session') {
  descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], {
    stdio: 'ignore'
  })
  console.log(`ORCA_DAEMON_MARKER_READY ${label} ${nonce} ${descendant.pid}`)
} else if (role === 'control') {
  controlTimer = setInterval(() => {}, 60_000)
  console.log(`ORCA_DAEMON_CONTROL_READY ${label} ${nonce} ${process.pid}`)
} else {
  throw new Error(`Unsupported daemon generation marker role: ${role}`)
}

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const prefix = `PING ${label} `
  if (line.startsWith(prefix)) {
    // Why: a transformed reply cannot be confused with the PTY's local input echo.
    console.log(`ORCA_DAEMON_MARKER_ACK ${label} ${line.slice(prefix.length)}`)
  }
})

function shutdown() {
  input.close()
  if (controlTimer) {
    clearInterval(controlTimer)
  }
  if (descendant?.pid) {
    try {
      process.kill(descendant.pid, 'SIGTERM')
    } catch {
      // The daemon or process-tree cleanup already stopped it.
    }
  }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
