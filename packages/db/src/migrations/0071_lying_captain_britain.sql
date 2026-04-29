CREATE TABLE "environment_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"execution_workspace_id" uuid,
	"issue_id" uuid,
	"heartbeat_run_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"lease_policy" text DEFAULT 'ephemeral' NOT NULL,
	"provider" text,
	"provider_lease_id" text,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"failure_reason" text,
	"cleanup_status" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"driver" text DEFAULT 'local' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heartbeat_run_watchdog_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"evaluation_issue_id" uuid,
	"decision" text NOT NULL,
	"snoozed_until" timestamp with time zone,
	"reason" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consensus_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"trigger_message_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"plan" jsonb NOT NULL,
	"debate_rounds" integer NOT NULL,
	"debate_outcome" text NOT NULL,
	"unresolved" jsonb,
	"classification" text DEFAULT 'complex' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consensus_decisions_correlation_id_unique" UNIQUE("correlation_id")
);
--> statement-breakpoint
CREATE TABLE "debate_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consensus_decision_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"leader_proposal" jsonb NOT NULL,
	"leader_reasoning" text NOT NULL,
	"da_decision" text NOT NULL,
	"da_challenge_points" jsonb DEFAULT '[]'::jsonb,
	"da_confidence" text,
	"leader_revision" jsonb,
	"leader_changes" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_thread_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"continuation_policy" text DEFAULT 'wake_assignee' NOT NULL,
	"idempotency_key" text,
	"source_comment_id" uuid,
	"source_run_id" uuid,
	"title" text,
	"summary" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"resolved_by_agent_id" uuid,
	"resolved_by_user_id" text,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_tree_hold_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"parent_issue_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"issue_identifier" text,
	"issue_title" text NOT NULL,
	"issue_status" text NOT NULL,
	"assignee_agent_id" uuid,
	"assignee_user_id" text,
	"active_run_id" uuid,
	"active_run_status" text,
	"skipped" boolean DEFAULT false NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_tree_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"root_issue_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"release_policy" jsonb,
	"created_by_actor_type" text DEFAULT 'system' NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"released_at" timestamp with time zone,
	"released_by_actor_type" text,
	"released_by_agent_id" uuid,
	"released_by_user_id" text,
	"released_by_run_id" uuid,
	"release_reason" text,
	"release_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"type" text NOT NULL,
	"sender" text NOT NULL,
	"sender_agent_id" uuid,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"linked_issue_ids" jsonb DEFAULT '[]'::jsonb,
	"debate_round" integer,
	"consensus_outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'IDLE' NOT NULL,
	"current_message_id" uuid,
	"linked_goal_id" uuid,
	"linked_project_id" uuid,
	"monthly_budget_usd" text DEFAULT '100.0000' NOT NULL,
	"spent_usd" text DEFAULT '0.0000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "worker_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"consensus_decision_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"task_definition" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pi_session_id" text,
	"pi_session_file_path" text,
	"output" text,
	"cost_usd" text DEFAULT '0.0000' NOT NULL,
	"error_details" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "issues_open_routine_execution_uq";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "default_environment_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "room_role" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "last_output_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "last_output_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "last_output_stream" text;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "last_output_bytes" bigint;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "origin_fingerprint" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "source_room_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "consensus_decision_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN "dispatch_fingerprint" text;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_leases" ADD CONSTRAINT "environment_leases_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_evaluation_issue_id_issues_id_fk" FOREIGN KEY ("evaluation_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_decisions" ADD CONSTRAINT "consensus_decisions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_decisions" ADD CONSTRAINT "consensus_decisions_trigger_message_id_room_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "public"."room_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_rounds" ADD CONSTRAINT "debate_rounds_consensus_decision_id_consensus_decisions_id_fk" FOREIGN KEY ("consensus_decision_id") REFERENCES "public"."consensus_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_source_comment_id_issue_comments_id_fk" FOREIGN KEY ("source_comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_source_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_hold_id_issue_tree_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."issue_tree_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_parent_issue_id_issues_id_fk" FOREIGN KEY ("parent_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_active_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("active_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_root_issue_id_issues_id_fk" FOREIGN KEY ("root_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_released_by_agent_id_agents_id_fk" FOREIGN KEY ("released_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_released_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("released_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_sender_agent_id_agents_id_fk" FOREIGN KEY ("sender_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_linked_goal_id_goals_id_fk" FOREIGN KEY ("linked_goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_sessions" ADD CONSTRAINT "worker_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_sessions" ADD CONSTRAINT "worker_sessions_consensus_decision_id_consensus_decisions_id_fk" FOREIGN KEY ("consensus_decision_id") REFERENCES "public"."consensus_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_sessions" ADD CONSTRAINT "worker_sessions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "environment_leases_company_environment_status_idx" ON "environment_leases" USING btree ("company_id","environment_id","status");--> statement-breakpoint
CREATE INDEX "environment_leases_company_execution_workspace_idx" ON "environment_leases" USING btree ("company_id","execution_workspace_id");--> statement-breakpoint
CREATE INDEX "environment_leases_company_issue_idx" ON "environment_leases" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "environment_leases_heartbeat_run_idx" ON "environment_leases" USING btree ("heartbeat_run_id");--> statement-breakpoint
CREATE INDEX "environment_leases_company_last_used_idx" ON "environment_leases" USING btree ("company_id","last_used_at");--> statement-breakpoint
CREATE INDEX "environment_leases_provider_lease_idx" ON "environment_leases" USING btree ("provider_lease_id");--> statement-breakpoint
CREATE INDEX "environments_company_status_idx" ON "environments" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_company_driver_idx" ON "environments" USING btree ("company_id","driver") WHERE "environments"."driver" = 'local';--> statement-breakpoint
CREATE INDEX "environments_company_name_idx" ON "environments" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "heartbeat_run_watchdog_decisions_company_run_created_idx" ON "heartbeat_run_watchdog_decisions" USING btree ("company_id","run_id","created_at");--> statement-breakpoint
CREATE INDEX "heartbeat_run_watchdog_decisions_company_run_snooze_idx" ON "heartbeat_run_watchdog_decisions" USING btree ("company_id","run_id","snoozed_until");--> statement-breakpoint
CREATE INDEX "idx_consensus_room" ON "consensus_decisions" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_debate_rounds_decision_round" ON "debate_rounds" USING btree ("consensus_decision_id","round_number");--> statement-breakpoint
CREATE INDEX "issue_thread_interactions_issue_idx" ON "issue_thread_interactions" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_thread_interactions_company_issue_created_at_idx" ON "issue_thread_interactions" USING btree ("company_id","issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_thread_interactions_company_issue_status_idx" ON "issue_thread_interactions" USING btree ("company_id","issue_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_thread_interactions_company_issue_idempotency_uq" ON "issue_thread_interactions" USING btree ("company_id","issue_id","idempotency_key") WHERE "issue_thread_interactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "issue_thread_interactions_source_comment_idx" ON "issue_thread_interactions" USING btree ("source_comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_tree_hold_members_hold_issue_uq" ON "issue_tree_hold_members" USING btree ("hold_id","issue_id");--> statement-breakpoint
CREATE INDEX "issue_tree_hold_members_company_issue_idx" ON "issue_tree_hold_members" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "issue_tree_hold_members_hold_depth_idx" ON "issue_tree_hold_members" USING btree ("hold_id","depth");--> statement-breakpoint
CREATE INDEX "issue_tree_holds_company_root_status_idx" ON "issue_tree_holds" USING btree ("company_id","root_issue_id","status");--> statement-breakpoint
CREATE INDEX "issue_tree_holds_company_status_mode_idx" ON "issue_tree_holds" USING btree ("company_id","status","mode");--> statement-breakpoint
CREATE INDEX "idx_room_messages_room_created" ON "room_messages" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_room_messages_correlation" ON "room_messages" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_room_messages_correlation_type" ON "room_messages" USING btree ("correlation_id","type");--> statement-breakpoint
CREATE INDEX "idx_rooms_company" ON "rooms" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_worker_sessions_issue" ON "worker_sessions" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_worker_sessions_consensus" ON "worker_sessions" USING btree ("consensus_decision_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_default_environment_id_environments_id_fk" FOREIGN KEY ("default_environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_source_room_id_rooms_id_fk" FOREIGN KEY ("source_room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_consensus_decision_id_consensus_decisions_id_fk" FOREIGN KEY ("consensus_decision_id") REFERENCES "public"."consensus_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_company_default_environment_idx" ON "agents" USING btree ("company_id","default_environment_id");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_company_status_last_output_idx" ON "heartbeat_runs" USING btree ("company_id","status","last_output_at");--> statement-breakpoint
CREATE INDEX "heartbeat_runs_company_status_process_started_idx" ON "heartbeat_runs" USING btree ("company_id","status","process_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_active_liveness_recovery_incident_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'harness_liveness_escalation'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "issues_active_liveness_recovery_leaf_uq" ON "issues" USING btree ("company_id","origin_kind","origin_fingerprint") WHERE "issues"."origin_kind" = 'harness_liveness_escalation'
          and "issues"."origin_fingerprint" <> 'default'
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "issues_active_stale_run_evaluation_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'stale_active_run_evaluation'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
CREATE INDEX "routine_runs_dispatch_fingerprint_idx" ON "routine_runs" USING btree ("routine_id","dispatch_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_open_routine_execution_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id","origin_fingerprint") WHERE "issues"."origin_kind" = 'routine_execution'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."execution_run_id" is not null
          and "issues"."status" in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked');