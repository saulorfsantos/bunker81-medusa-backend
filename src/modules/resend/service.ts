import { createHash } from "node:crypto"
import { AbstractNotificationProviderService } from "@medusajs/framework/utils"
import type {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"

type ResendOptions = {
  api_key: string
  from: string
  reply_to: string
  storefront_url: string
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!)

export default class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-resend"

  constructor(_container: Record<string, unknown>, private readonly options: ResendOptions) {
    super()
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    if (notification.channel !== "email" || notification.template !== "customer-password-reset") {
      throw new Error("Unsupported Resend notification template or channel")
    }
    const resetUrl = notification.data?.reset_url
    if (typeof resetUrl !== "string") throw new Error("Missing customer reset URL")
    let url: URL
    try {
      url = new URL(resetUrl)
    } catch {
      throw new Error("Invalid customer reset URL")
    }
    if (url.origin !== this.options.storefront_url || url.pathname !== "/reset-password" ||
        url.username || url.password || url.hash || !url.searchParams.get("token") ||
        url.searchParams.get("email") !== notification.to) {
      throw new Error("Invalid customer reset URL")
    }

    // Stable across delivery retries; never put the raw reset token in headers or logs.
    const idempotencyKey = "customer-reset/" + createHash("sha256")
      .update(JSON.stringify([notification.to, resetUrl])).digest("hex")
    const link = escapeHtml(resetUrl)
    let response: Response
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.options.api_key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [notification.to],
          reply_to: this.options.reply_to,
          subject: "Redefina sua senha — Bunker 81",
          html: `<html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#222;line-height:1.6"><h1>Bunker 81</h1><h2>Redefina sua senha</h2><p>Recebemos um pedido para alterar a senha da sua conta.</p><p><a href="${link}" style="background:#222;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Criar nova senha</a></p><p>Este link é temporário e só pode ser usado uma vez. Se ele expirar, solicite outro na loja.</p><p>Se você não pediu essa alteração, pode ignorar este e-mail. Sua senha continuará a mesma.</p><p>Precisa de ajuda? Responda a este e-mail.</p></body></html>`,
          text: `Bunker 81\n\nRecebemos um pedido para alterar a senha da sua conta.\n\nCrie sua nova senha: ${resetUrl}\n\nEste link é temporário e só pode ser usado uma vez. Se ele expirar, solicite outro na loja.\n\nSe você não pediu essa alteração, ignore este e-mail. Sua senha continuará a mesma.\n\nPrecisa de ajuda? Responda a este e-mail.`,
        }),
      })
    } catch {
      // Transport errors may contain request details; do not expose credentials or reset links.
      throw new Error("Resend password reset delivery failed: network error or timeout")
    }
    if (!response.ok) {
      throw new Error(`Resend password reset delivery failed (HTTP ${response.status})`)
    }
    let result: { id?: unknown }
    try {
      result = await response.json() as { id?: unknown }
    } catch {
      throw new Error("Resend password reset delivery returned an invalid response")
    }
    if (!result || typeof result.id !== "string" || !result.id) {
      throw new Error("Resend password reset delivery returned no message ID")
    }
    return { id: result.id }
  }
}
