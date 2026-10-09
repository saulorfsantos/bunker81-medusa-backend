export function readResendConfig(env: NodeJS.ProcessEnv) {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.RESEND_FROM?.trim()
  if (!apiKey && !from) return null

  if (!apiKey || !from || !env.STOREFRONT_URL?.trim()) {
    throw new Error(
      "Customer password reset email requires RESEND_API_KEY, RESEND_FROM, and STOREFRONT_URL"
    )
  }

  let url: URL
  try {
    url = new URL(env.STOREFRONT_URL.trim())
  } catch {
    throw new Error("STOREFRONT_URL must be a valid storefront origin")
  }
  const localHttp = env.NODE_ENV !== "production" &&
    url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
  if ((!localHttp && url.protocol !== "https:") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("STOREFRONT_URL must be an HTTPS origin without credentials, path, query, or fragment")
  }

  return {
    api_key: apiKey,
    from,
    reply_to: env.RESEND_REPLY_TO?.trim() || from.match(/<([^<>]+)>$/)?.[1] || from,
    storefront_url: url.origin,
  }
}
