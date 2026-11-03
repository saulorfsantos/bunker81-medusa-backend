import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261103120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "orcamento" (
        "id" text not null,
        "numero" serial,
        "cliente_nome" text null,
        "cliente_documento" text null,
        "cliente_email" text null,
        "cliente_telefone" text null,
        "observacoes" text null,
        "itens" jsonb not null,
        "total_centavos" integer not null,
        "operador" text null,
        "criado_por" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "orcamento_pkey" primary key ("id")
      );
    `)
    this.addSql(
      'create index if not exists "IDX_orcamento_deleted_at" on "orcamento" ("deleted_at") where "deleted_at" is not null;'
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orcamento" cascade;')
  }
}
