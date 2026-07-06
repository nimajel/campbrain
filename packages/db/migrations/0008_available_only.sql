TRUNCATE TABLE "availability";--> statement-breakpoint
ALTER TABLE "availability" DROP CONSTRAINT "availability_status_check";--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_status_check" CHECK (status IN ('available', 'unknown'));
