CREATE TABLE "audit_links" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"source_page_id" text NOT NULL,
	"target_page_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_links" ADD CONSTRAINT "audit_links_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_links_audit_idx" ON "audit_links" USING btree ("audit_id");