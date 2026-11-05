import { z } from 'zod'
import { workflowIssues } from './workflows'
const id = z.string().min(1).max(200)
const effort = z
  .string()
  .max(30)
  .regex(/^[a-z]*$/)
export const agentSchema = z
  .object({
    id,
    name: z.string().min(1).max(80),
    provider: z.enum(['codex', 'claude', 'antigravity']),
    role: z.string().max(500),
    instructions: z.string().max(12000),
    model: z.string().max(200),
    reasoningEffort: effort.optional(),
    enabled: z.boolean(),
    authMode: z.enum(['native', 'api']).optional(),
    networkAllowlist: z
      .array(
        z
          .string()
          .min(1)
          .max(253)
          .regex(
            /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,
          ),
      )
      .max(20)
      .optional(),
    commandAllowlist: z
      .array(
        z
          .string()
          .min(1)
          .max(1000)
          .refine((value) => !/[\r\n\0]/.test(value)),
      )
      .max(20)
      .optional(),
  })
  .strict()
export const settingsSchema = z
  .object({
    notifications: z.enum(['all', 'approvals', 'off']).default('all'),
    theme: z.enum(['dark', 'light', 'system']),
    language: z.enum(['zh-TW', 'en']),
    maxTurns: z.number().int().min(1).max(100),
    maxConcurrent: z.number().int().min(1).max(8),
    maxDepth: z.number().int().min(0).max(8),
    maxFanout: z.number().int().min(1).max(8),
    timeoutMs: z.number().int().min(10000).max(3600000),
    supervisorId: z.string().max(200),
    maxUsageTokens: z.number().int().min(0).max(100000000).default(200000),
    maxCostUsd: z.number().min(0).max(10000).default(5),
    defaultMode: z.enum(['manual', 'collaborative', 'supervisor']).default('manual'),
    defaultProjectDirectory: z.string().max(4096).default(''),
    startupBehavior: z.enum(['restore', 'empty']).default('restore'),
    automaticReview: z.boolean().default(false),
    reviewerId: z.string().max(200).default(''),
  })
  .strict()
export const collaborationSchema = z
  .object({
    operation: z.enum([
      'send_message',
      'request_response',
      'broadcast_message',
      'assign_task',
      'request_review',
      'report_progress',
      'report_completion',
      'publish_artifact',
      'read_artifact',
      'submit_review',
      'search_context',
      'read_context',
      'submit_plan',
      'submit_handoff',
      'propose_decision',
    ]),
    recipients: z.array(id).max(8),
    content: z.string().min(1).max(16000),
    dependencies: z.array(id).max(20).default([]),
    paths: z.array(z.string().min(1).max(1024)).max(20).optional(),
    artifactId: id.optional(),
    messageIds: z.array(id).max(6).optional(),
    attachmentIds: z.array(id).max(8).optional(),
    verdict: z.enum(['approve', 'changes_requested']).optional(),
    plan: z
      .object({
        files: z.array(z.string().min(1).max(1024)).max(60).default([]),
        steps: z.array(z.string().min(1).max(2000)).max(30).default([]),
        risks: z.array(z.string().min(1).max(2000)).max(20).default([]),
        verification: z.string().max(4000).default(''),
      })
      .strict()
      .optional(),
    decision: z
      .object({ title: z.string().trim().min(1).max(200) })
      .strict()
      .optional(),
    handoff: z
      .object({
        changed: z.array(z.string().min(1).max(1000)).max(40).default([]),
        tested: z.array(z.string().min(1).max(1000)).max(30).default([]),
        untested: z.array(z.string().min(1).max(1000)).max(30).default([]),
        questions: z.array(z.string().min(1).max(1000)).max(20).default([]),
        next: z.array(z.string().min(1).max(1000)).max(20).default([]),
      })
      .strict()
      .optional(),
    comments: z
      .array(
        z
          .object({
            file: z.string().max(1024),
            line: z.number().int().min(1),
            severity: z.enum(['info', 'warning', 'error']),
            content: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict()
export type CollaborationInput = z.infer<typeof collaborationSchema>
export const collaborationJsonSchema = z.toJSONSchema(collaborationSchema)
const workflowKey = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/)
export const workflowTemplateSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000),
    maxFixes: z.number().int().min(0).max(5),
    roles: z
      .array(
        z
          .object({
            id: workflowKey,
            name: z.string().trim().min(1).max(100),
            provider: z.enum(['codex', 'claude', 'antigravity']),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    steps: z
      .array(
        z
          .object({
            id: workflowKey,
            name: z.string().trim().min(1).max(100),
            kind: z.enum(['task', 'review', 'integrate']),
            roleId: workflowKey,
            instructions: z.string().max(8000),
            dependsOn: z.array(workflowKey).max(24),
            artifactFrom: z.array(workflowKey).max(24),
            publishArtifact: z.boolean(),
            sourceStepId: z.string().max(80),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const message of workflowIssues(value)) ctx.addIssue({ code: 'custom', message })
  })
export const requestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('workflow.save'), template: workflowTemplateSchema }).strict(),
  z.object({ op: z.literal('workflow.delete'), id }).strict(),
  z.object({ op: z.literal('overlaps.scan'), projectId: id }).strict(),
  z.object({ op: z.literal('github.status'), projectId: id }).strict(),
  z.object({ op: z.literal('github.issues'), projectId: id }).strict(),
  z
    .object({
      op: z.literal('github.issue.import'),
      conversationId: id,
      number: z.number().int().positive(),
      recipients: z.array(id).min(1).max(8),
      planFirst: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.literal('github.pr.prepare'), taskId: id }).strict(),
  z
    .object({
      op: z.literal('github.pr.create'),
      taskId: id,
      title: z.string().trim().min(1).max(256),
      body: z.string().max(60000),
      branch: z
        .string()
        .regex(/^agenthub\/[A-Za-z0-9._-]{1,80}$/)
        .refine((b) => !b.includes('..') && !b.endsWith('.lock') && !b.endsWith('.')),
    })
    .strict(),
  z.object({ op: z.literal('github.pr.push'), taskId: id }).strict(),
  z.object({ op: z.literal('github.pr.refresh'), taskId: id }).strict(),
  z.object({ op: z.literal('github.ci.fix'), taskId: id }).strict(),
  z
    .object({
      op: z.literal('github.open'),
      url: z
        .string()
        .url()
        .max(2048)
        .refine((u) => u.startsWith('https://github.com/')),
    })
    .strict(),
  z
    .object({
      op: z.literal('decision.save'),
      projectId: id,
      id: id.optional(),
      title: z.string().trim().min(1).max(200),
      detail: z.string().trim().max(4000),
      status: z.enum(['proposed', 'accepted', 'rejected']),
    })
    .strict(),
  z.object({ op: z.literal('decision.delete'), projectId: id, id }).strict(),
  z
    .object({
      op: z.literal('workflow.start'),
      templateId: id,
      conversationId: id,
      requirement: z.string().trim().min(1).max(16000),
      bindings: z.record(workflowKey, id),
    })
    .strict(),
  z
    .object({ op: z.literal('workflow.action'), id, action: z.enum(['pause', 'resume', 'cancel']) })
    .strict(),
  z.object({ op: z.literal('processes.inspect') }).strict(),
  z.object({ op: z.literal('context.pin'), messageId: id, enabled: z.boolean() }),
  z.object({ op: z.literal('context.receipts'), conversationId: id }),
  z.object({
    op: z.literal('context.read'),
    conversationId: id,
    messageIds: z.array(id).min(1).max(6),
  }),
  z.object({
    op: z.literal('conversation.runtime'),
    conversationId: id,
    agentId: id,
    model: z.string().max(200),
    reasoningEffort: effort,
  }),
  z.object({ op: z.literal('snapshot') }),
  z
    .object({
      op: z.literal('quotas.read'),
      agentIds: z.array(id).min(1).max(32),
      refresh: z.boolean().default(false),
    })
    .strict(),
  z.object({ op: z.literal('project.pick') }),
  z.object({ op: z.literal('docs.guide') }).strict(),
  z.object({ op: z.literal('project.automation'), projectId: id, enabled: z.boolean() }).strict(),
  z.object({ op: z.literal('task.integrate'), id }).strict(),
  z.object({ op: z.literal('project.operations'), projectId: id }).strict(),
  z.object({ op: z.literal('project.inspect'), projectId: id }).strict(),
  z.object({ op: z.literal('project.checkpoint'), projectId: id }).strict(),
  z.object({ op: z.literal('project.rename'), id, name: z.string().min(1).max(100) }),
  z.object({ op: z.literal('project.remove'), id }),
  z.object({ op: z.literal('project.open'), id }),
  z.object({ op: z.literal('attachment.get'), id }),
  z.object({ op: z.literal('attachment.discard'), id }),
  z.object({ op: z.literal('attachment.clipboard'), projectId: id }),
  z.object({
    op: z.literal('attachment.read'),
    projectId: id,
    paths: z.array(z.string().min(1).max(4096)).min(1).max(8),
  }),
  z.object({
    op: z.literal('project.team'),
    id,
    agentIds: z.array(id).max(32),
    overrides: z.record(
      id,
      z.object({ role: z.string().max(500), instructions: z.string().max(12000) }).strict(),
    ),
  }),
  z.object({ op: z.literal('conversation.create'), projectId: id }),
  z.object({ op: z.literal('notifications.ready') }).strict(),
  z.object({ op: z.literal('notifications.read'), conversationId: id }).strict(),
  z.object({ op: z.literal('notifications.test'), conversationId: id.optional() }).strict(),
  z.object({
    op: z.literal('conversation.configure'),
    id,
    mode: z.enum(['manual', 'collaborative', 'supervisor']),
    supervisorId: z.string().max(200),
  }),
  z.object({
    op: z.literal('messages'),
    conversationId: id,
    search: z.string().max(500).optional(),
    before: z.number().int().positive().optional(),
  }),
  z.object({
    op: z.literal('send'),
    conversationId: id,
    content: z.string().min(1).max(64000),
    recipients: z.array(id).max(8),
    replyTo: id.optional(),
    attachmentIds: z.array(id).max(8).optional(),
    planFirst: z.boolean().optional(),
  }),
  z
    .object({
      op: z.literal('task.plan'),
      id,
      action: z.enum(['approve', 'revise', 'cancel']),
      content: z.string().trim().min(1).max(32000).optional(),
      feedback: z.string().trim().min(1).max(8000).optional(),
    })
    .strict(),
  z.object({ op: z.literal('stop'), conversationId: id }),
  z.object({ op: z.literal('resume'), conversationId: id }),
  z.object({ op: z.literal('task.action'), id, action: z.enum(['pause', 'resume', 'cancel']) }),
  z.object({
    op: z.literal('task.create'),
    conversationId: id,
    agentId: id,
    description: z.string().min(1).max(16000),
    dependencies: z.array(id).max(20),
  }),
  z.object({ op: z.literal('task.reassign'), id, agentId: id }),
  z.object({ op: z.literal('approve'), id, allow: z.boolean(), remember: z.boolean().optional() }),
  z.object({ op: z.literal('permissions.clear') }),
  z.object({ op: z.literal('agents.detect') }),
  z.object({ op: z.literal('agent.save'), agent: agentSchema }),
  z.object({ op: z.literal('settings.save'), settings: settingsSchema }),
  z.object({
    op: z.literal('credential.save'),
    provider: z.literal('claude'),
    value: z.string().max(4096),
  }),
  z.object({ op: z.literal('workspace.prepare'), projectId: id, initialize: z.boolean() }),
  z.object({ op: z.literal('git.initial.preview'), projectId: id }),
  z.object({
    op: z.literal('git.initial.commit'),
    previewId: id,
    files: z.array(z.string().min(1).max(4096)).min(1).max(1000),
  }),
  z.object({ op: z.literal('git.ignore'), projectId: id }),
  z.object({ op: z.literal('git.diff'), workspaceId: id, taskId: id.optional() }),
  z
    .object({
      op: z.literal('diff.feedback'),
      conversationId: id,
      workspaceId: id,
      comments: z
        .array(
          z
            .object({
              file: z.string().min(1).max(1024),
              line: z.number().int().min(1),
              content: z.string().trim().min(1).max(4000),
            })
            .strict(),
        )
        .min(1)
        .max(50),
      note: z.string().trim().max(4000).optional(),
    })
    .strict(),
  z.object({
    op: z.literal('git.checkpoint'),
    workspaceId: id,
    message: z.string().min(1).max(200),
  }),
  z.object({
    op: z.literal('git.preview'),
    workspaceId: id,
    direction: z.enum(['integrate', 'sync']).default('integrate'),
  }),
  z.object({ op: z.literal('git.merge'), previewId: id }),
  z.object({
    op: z.literal('test.run'),
    workspaceId: id,
    script: z.enum(['test', 'build', 'install', 'pytest', 'unittest', 'dotnet', 'cargo', 'go']),
  }),
  z.object({ op: z.literal('test.cancel'), id }),
  z.object({ op: z.literal('export'), conversationId: id, format: z.enum(['json', 'markdown']) }),
  z.object({ op: z.literal('backup') }),
  z.object({ op: z.literal('restore.preview') }),
  z.object({ op: z.literal('restore.apply'), previewId: id }),
  z.object({ op: z.literal('history.clear'), conversationId: id }),
  z.object({
    op: z.literal('review.request'),
    workspaceId: id,
    conversationId: id,
    reviewerId: id,
  }),
  z.object({ op: z.literal('review.resolve'), reviewId: id, commentId: id, resolved: z.boolean() }),
  z.object({ op: z.literal('review.fix'), reviewId: id }),
  z.object({ op: z.literal('review.context'), reviewId: id, commentId: id }),
  z.object({ op: z.literal('artifact.read'), id }),
  z.object({ op: z.literal('git.revert.preview'), workspaceId: id }),
  z.object({ op: z.literal('git.project.revert.preview'), projectId: id }),
  z.object({ op: z.literal('git.preview.discard'), previewId: id }),
  z.object({ op: z.literal('maintenance.cleanup') }),
  z.object({ op: z.literal('docs.open'), provider: z.enum(['codex', 'claude', 'antigravity']) }),
  z.object({ op: z.literal('attachment.pick'), projectId: id }),
])
export type Request = z.infer<typeof requestSchema>
