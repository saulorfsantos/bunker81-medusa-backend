import {
  assertCard140SandboxEnv,
  verifyCard140Runtime,
} from "../local-sandbox/preflight"

async function main() {
  const configOnly = process.argv.includes("--config-only")
  const config = assertCard140SandboxEnv(process.env)
  if (!configOnly) await verifyCard140Runtime(process.env)
  console.log(
    `Card 140 preflight passed (${configOnly ? "configuration" : "runtime"}; ` +
      `PostgreSQL=${config.databaseUrl.hostname}:${config.postgresPort}/${config.databaseUrl.pathname.slice(1)}; ` +
      `Redis=${config.redisUrl.hostname}:${config.redisPort})`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Card 140 preflight failed")
  process.exitCode = 1
})
