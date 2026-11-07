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

export type OrderEmailData = {
  id: string
  display_id: number | string
  customer_name: string
  email: string
  total: number
  items: { title: string; quantity: number; total: number }[]
}

const ORDER_TEMPLATES = new Set(["order-placed-customer", "order-placed-admin"])

const brl = (value: unknown) =>
  (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export default class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-resend"

  constructor(_container: Record<string, unknown>, private readonly options: ResendOptions) {
    super()
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    if (notification.channel === "email" && ORDER_TEMPLATES.has(notification.template)) {
      return this.sendOrder(notification)
    }
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
    return this.deliver("password reset", idempotencyKey, {
      to: [notification.to],
      subject: "Redefina sua senha — Bunker 81",
      html: `<html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#222;line-height:1.6"><h1>Bunker 81</h1><h2>Redefina sua senha</h2><p>Recebemos um pedido para alterar a senha da sua conta.</p><p><a href="${link}" style="background:#222;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Criar nova senha</a></p><p>Este link é temporário e só pode ser usado uma vez. Se ele expirar, solicite outro na loja.</p><p>Se você não pediu essa alteração, pode ignorar este e-mail. Sua senha continuará a mesma.</p><p>Precisa de ajuda? Responda a este e-mail.</p></body></html>`,
      text: `Bunker 81\n\nRecebemos um pedido para alterar a senha da sua conta.\n\nCrie sua nova senha: ${resetUrl}\n\nEste link é temporário e só pode ser usado uma vez. Se ele expirar, solicite outro na loja.\n\nSe você não pediu essa alteração, ignore este e-mail. Sua senha continuará a mesma.\n\nPrecisa de ajuda? Responda a este e-mail.`,
    })
  }

  private async sendOrder(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const order = notification.data as OrderEmailData | undefined
    if (!order?.id || !Array.isArray(order.items)) throw new Error("Missing order data")
    const forStaff = notification.template === "order-placed-admin"
    const numero = `#${order.display_id}`
    const linhas = order.items.map((item) => [item.quantity, item.title, brl(item.total)] as const)
    const tabela = linhas.map(([qtd, titulo, valor]) =>
      `<tr><td style="padding:4px 8px">${qtd}×</td><td style="padding:4px 8px">${escapeHtml(String(titulo))}</td><td style="padding:4px 8px;text-align:right">${valor}</td></tr>`).join("")
    const intro = forStaff
      ? `<p>Nova venda na loja online: pedido <strong>${numero}</strong> de ${escapeHtml(order.customer_name)} (${escapeHtml(order.email)}).</p>`
      : `<p>Olá, ${escapeHtml(order.customer_name)}! Recebemos seu pedido <strong>${numero}</strong>. Obrigado por comprar na Bunker 81.</p><p>Avisaremos por e-mail quando ele for enviado.</p>`
    const textoIntro = forStaff
      ? `Nova venda na loja online: pedido ${numero} de ${order.customer_name} (${order.email}).`
      : `Olá, ${order.customer_name}! Recebemos seu pedido ${numero}. Obrigado por comprar na Bunker 81.\nAvisaremos por e-mail quando ele for enviado.`
    const rodape = forStaff ? "" : "<p>Dúvidas? Responda a este e-mail.</p>"
    return this.deliver("order", `${notification.template}/${order.id}`, {
      to: [notification.to],
      subject: forStaff
        ? `Nova venda ${numero} — ${brl(order.total)}`
        : `Pedido ${numero} recebido — Bunker 81`,
      html: `<html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#222;line-height:1.6"><h1>Bunker 81</h1>${intro}<table style="border-collapse:collapse">${tabela}<tr><td></td><td style="padding:4px 8px"><strong>Total</strong></td><td style="padding:4px 8px;text-align:right"><strong>${brl(order.total)}</strong></td></tr></table>${rodape}</body></html>`,
      text: `Bunker 81\n\n${textoIntro}\n\n${linhas.map(([qtd, titulo, valor]) => `${qtd}x ${titulo} — ${valor}`).join("\n")}\nTotal: ${brl(order.total)}`,
    })
  }

  private async deliver(label: string, idempotencyKey: string, email: { to: string[]; subject: string; html: string; text: string }) {
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
        body: JSON.stringify({ from: this.options.from, reply_to: this.options.reply_to, ...email }),
      })
    } catch {
      // Transport errors may contain request details; do not expose credentials or reset links.
      throw new Error(`Resend ${label} delivery failed: network error or timeout`)
    }
    if (!response.ok) {
      throw new Error(`Resend ${label} delivery failed (HTTP ${response.status})`)
    }
    let result: { id?: unknown }
    try {
      result = await response.json() as { id?: unknown }
    } catch {
      throw new Error(`Resend ${label} delivery returned an invalid response`)
    }
    if (!result || typeof result.id !== "string" || !result.id) {
      throw new Error(`Resend ${label} delivery returned no message ID`)
    }
    return { id: result.id }
  }
}
