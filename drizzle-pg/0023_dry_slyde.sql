ALTER TABLE "audit_pages" ADD COLUMN "keywords_json" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "pagerank" real;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "centrality_score" real;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "inbound_link_count" integer;