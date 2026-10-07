import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

interface PasswordResetEvent {
  entity_id: string
  token: string
  actor_type: string
}

export function buildCustomerResetUrl(
  storefrontUrl: string,
  token: string,
  email: string
): string {
  const url = new URL("/reset-password", storefrontUrl)
  url.searchParams.set("token", token)
  url.searchParams.set("email", email)
  return url.toString()
}

export default async function passwordResetHandler({
  event: { data },
  container,
}: SubscriberArgs<PasswordResetEvent>) {
  if (data.actor_type !== "customer") return

  const storefrontUrl = process.env.STOREFRONT_URL
  const template = process.env.SENDGRID_PASSWORD_RESET_TEMPLATE
  if (!storefrontUrl || !template) {
    throw new Error(
      "Customer password reset email requires STOREFRONT_URL and SENDGRID_PASSWORD_RESET_TEMPLATE"
    )
  }

  const notificationModuleService = container.resolve(Modules.NOTIFICATION)
  await notificationModuleService.createNotifications({
    to: data.entity_id,
    channel: "email",
    template,
    data: {
      email: data.entity_id,
      reset_url: buildCustomerResetUrl(
        storefrontUrl,
        data.token,
        data.entity_id
      ),
    },
  })
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
  context: {
    subscriberId: "bunker-customer-password-reset-email",
  },
}
