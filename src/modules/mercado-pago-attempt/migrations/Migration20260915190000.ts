import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260915190000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "mercado_pago_attempt" drop constraint if exists "mercado_pago_attempt_state_check";'
    )
    this.addSql(
      'alter table "mercado_pago_attempt" add constraint "mercado_pago_attempt_state_check" check ("state" in (\'creating\', \'bound\', \'remote_found\', \'compensated\', \'resolved_terminal\', \'manual_review\', \'reviewed\'));'
    )
    this.addSql(
      'alter table "mercado_pago_attempt" add column if not exists "reviewed_at" timestamptz null, add column if not exists "reviewed_by" text null, add column if not exists "review_note" text null;'
    )
    this.addSql('drop index if exists "IDX_mp_attempt_reconcile_after";')
    this.addSql(
      'create index if not exists "IDX_mp_attempt_reconcile_after" on "mercado_pago_attempt" ("state", "reconcile_after") where "deleted_at" is null;'
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'update "mercado_pago_attempt" set "state" = \'manual_review\' where "state" = \'reviewed\';'
    )
    this.addSql(
      'alter table "mercado_pago_attempt" drop constraint if exists "mercado_pago_attempt_state_check";'
    )
    this.addSql(
      'alter table "mercado_pago_attempt" add constraint "mercado_pago_attempt_state_check" check ("state" in (\'creating\', \'bound\', \'remote_found\', \'compensated\', \'resolved_terminal\', \'manual_review\'));'
    )
    this.addSql(
      'alter table "mercado_pago_attempt" drop column if exists "reviewed_at", drop column if exists "reviewed_by", drop column if exists "review_note";'
    )
    this.addSql('drop index if exists "IDX_mp_attempt_reconcile_after";')
    this.addSql(
      'create index if not exists "IDX_mp_attempt_reconcile_after" on "mercado_pago_attempt" ("reconcile_after") where "deleted_at" is null;'
    )
  }
}
