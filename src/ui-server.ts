import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { access, constants, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { exportPatchBundle } from './delivery.js';
import { logger } from './logger.js';
import {
  assessBenchmarkFreshness,
  buildModelStatus,
  fetchOllamaModelInventory,
  readLatestModelBenchmarkSummary,
} from './model-diagnostics.js';
import { deriveRecoveryRecommendation } from './recovery-recommendation.js';
import { computeOperationalSLOMetrics, type OperationalSLOMetrics } from './slo-metrics.js';
import { TicketStoreRepository } from './task-store.js';
import type {
  PromotionRecord,
  TaskAttempt,
  TaskEvent,
  TaskStatus,
  TaskTicket,
  ToolCall,
  WorkerVersion,
} from './types.js';
import { renderUIHtml } from './ui.js';

export type UIRole = 'viewer' | 'operator' | 'approver' | 'admin';

export interface UIAuthToken {
  role: UIRole;
  token: string;
  label: string;
}

export interface UIServerOptions {
  host?: string;
  port?: number;
  repository?: TicketStoreRepository;
  tasksFile?: string;
  storeFile?: string;
  baselineFile?: string;
  sseIntervalMs?: number;
  authTokens?: UIAuthToken[];
}

interface UIPermissionSet {
  query: boolean;
  create: boolean;
  retry: boolean;
  cancel: boolean;
  supersede: boolean;
  exportBundle: boolean;
  approve: boolean;
  reject: boolean;
  resume: boolean;
}

interface StoreSnapshot {
  tickets: TaskTicket[];
  attemptsByTicket: Map<string, TaskAttempt[]>;
  recentEvents: TaskEvent[];
  metrics: OperationalSLOMetrics;
}

interface BaselineSnapshot {
  markdown: string;
  values: Record<string, string>;
}

interface EfficiencySnapshot {
  timestamp?: string;
  efficiencyIndex?: {
    score?: number;
    targetScore?: number;
    status?: string;
  };
  throughput?: {
    completedPerDay?: number;
  };
  latencyMs?: {
    admissionToComplete?: {
      p95?: number;
    };
  };
  quality?: {
    completionRate?: number;
    retryRate?: number;
  };
  variance?: {
    alerts?: string[];
  };
}

interface PayloadMetadata {
  schemaVersion: string;
  generatedAt: string;
  revision: string;
  windows: {
    recentTickets: number;
    recentEvents: number;
  };
  sources: {
    baselineAvailable: boolean;
    efficiencySnapshotAvailable: boolean;
  };
}

interface PolicySnapshotArtifact {
  raw: string;
  correlationId?: string;
  signature?: string;
  parsed?: Record<string, unknown>;
}

interface PatchDeltaArtifact {
  raw: string;
  correlationId?: string;
  subject: string;
  dryRun: string;
  apply: string;
  mutatedPaths: string[];
}

interface FlattenedArtifact {
  attemptId: string;
  attemptNumber: number;
  raw: string;
}

interface TicketDetailWorkerVersion extends WorkerVersion {
  ticketId: string;
  attemptNumber: number;
}

interface TicketDetailPromotion extends PromotionRecord {
  ticketId: string;
  attemptId: string;
  attemptNumber: number;
  workspaceId?: string;
  workspaceRoot?: string;
  isolationMode?: TaskAttempt['isolationMode'];
  patchBundlePath?: string;
  verificationSummary?: string;
  workerVersionStatus?: WorkerVersion['status'];
}

interface TicketTimelineEntry {
  at: string;
  source: string;
  detail: string;
}

interface ApprovalQueueItem {
  ticket: TaskTicket;
  currentPatch?: string;
  policySnapshots: PolicySnapshotArtifact[];
  patchDeltas: PatchDeltaArtifact[];
  patchDeltaSummary?: string;
}

interface SseClient {
  id: string;
  response: ServerResponse;
}

const roleRank: Record<UIRole, number> = {
  viewer: 0,
  operator: 1,
  approver: 2,
  admin: 3,
};

const defaultAdminToken = 'hephaestus-local-admin-token';
const defaultHost = '127.0.0.1';
const defaultPort = 4180;
const defaultSseIntervalMs = 2_000;
const overviewRecentTicketLimit = 12;
const overviewRecentEventLimit = 18;
const reliabilityRecentEventLimit = 24;

export class UIServer {
  private readonly host: string;
  private readonly port: number;
  private readonly repository: TicketStoreRepository;
  private readonly ownsRepository: boolean;
  private readonly baselineFile: string;
  private readonly efficiencySnapshotFile: string;
  private readonly sseIntervalMs: number;
  private readonly authTokens: UIAuthToken[];
  private readonly defaultTokenInUse: boolean;
  private readonly serverName = 'hephaestus-ui/v1';
  private server: Server | null = null;
  private ssePollTimer: NodeJS.Timeout | null = null;
  private sseClients = new Set<SseClient>();
  private revisionStamp = '';

  constructor(options: UIServerOptions = {}) {
    this.host = options.host ?? getEnv('UI_HOST', defaultHost);
    this.port = options.port ?? getEnvNumber('UI_PORT', defaultPort);
    this.repository = options.repository ?? new TicketStoreRepository({
      tasksFile: options.tasksFile ?? config.tasksFile,
      storeFile: options.storeFile ?? config.ticketStoreFile,
      allowMarkdownFallback: config.allowMarkdownTaskFallback,
      projectionEnabled: config.taskBoardProjectionEnabled,
    });
    this.ownsRepository = !options.repository;
    this.baselineFile = options.baselineFile ?? path.join(config.baseDir, 'docs', 'reliability-baselines.md');
    this.efficiencySnapshotFile = path.join(config.baseDir, 'docs', 'metrics', 'efficiency-latest.json');
    this.sseIntervalMs = options.sseIntervalMs ?? getEnvNumber('UI_SSE_INTERVAL_MS', defaultSseIntervalMs);
    const parsedTokens = options.authTokens ?? parseUITokens(getEnv('UI_TOKENS'));
    this.authTokens = parsedTokens;
    this.defaultTokenInUse = options.authTokens === undefined && parsedTokens.length === 1 && parsedTokens[0]?.token === defaultAdminToken;
  }

  async start(): Promise<{ url: string }> {
    if (this.server) {
      return { url: this.getBaseUrl() };
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, this.host, () => resolve());
    });

    this.revisionStamp = await this.computeRevisionStamp();
    this.startSsePolling();

    const url = this.getBaseUrl();
    logger.info(`UI listening on ${url}`);
    if (this.defaultTokenInUse) {
      logger.warn(`UI is using the default local admin token: ${defaultAdminToken}`);
      logger.warn('Set UI_TOKENS to replace the local development token before wider use.');
    }

    return { url };
  }

  async stop(): Promise<void> {
    if (this.ssePollTimer) {
      clearInterval(this.ssePollTimer);
      this.ssePollTimer = null;
    }

    for (const client of this.sseClients) {
      try {
        client.response.end();
      } catch {
        // Ignore shutdown cleanup errors.
      }
    }
    this.sseClients.clear();

    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    if (this.ownsRepository) {
      await this.repository.stop();
    }
  }

  private getBaseUrl(): string {
    if (!this.server) {
      return `http://${this.host}:${this.port}`;
    }

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      return `http://${this.host}:${this.port}`;
    }

    const host = address.address === '::' ? '127.0.0.1' : address.address;
    return `http://${host}:${address.port}`;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', this.getBaseUrl());

      if (request.method === 'GET' && url.pathname === '/') {
        this.respondHtml(response, renderUIHtml());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/favicon.ico') {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        this.respondJson(response, 200, await this.buildHealthResponse());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/session') {
        const role = this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildSessionResponse(role));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/overview') {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildOverviewResponse());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/model-status') {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildModelStatusResponse());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/tickets') {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildTicketListResponse(url.searchParams));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/tickets') {
        this.requireRole(request, url, 'operator');
        const payload = await this.readJsonBody(request, 16 * 1024);
        const description = requireNonEmptyString(payload.description, 'description');
        const ticket = await this.repository.createTicket(description);
        await this.broadcastRefresh('ticket-created');
        this.respondJson(response, 201, await this.buildTicketDetailResponse(ticket.id));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/approvals') {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildApprovalQueueResponse());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/reliability') {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildReliabilityResponse());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/stream') {
        this.requireRole(request, url, 'viewer');
        await this.openEventStream(response);
        return;
      }

      const ticketDetailMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
      if (request.method === 'GET' && ticketDetailMatch) {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildTicketDetailResponse(decodeURIComponent(ticketDetailMatch[1] ?? '')));
        return;
      }

      const ticketTimelineMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/timeline$/);
      if (request.method === 'GET' && ticketTimelineMatch) {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildTicketTimelineResponse(decodeURIComponent(ticketTimelineMatch[1] ?? '')));
        return;
      }

      const ticketEvidenceMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/evidence$/);
      if (request.method === 'GET' && ticketEvidenceMatch) {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildTicketEvidenceResponse(decodeURIComponent(ticketEvidenceMatch[1] ?? '')));
        return;
      }

      const ticketGatesMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/gates$/);
      if (request.method === 'GET' && ticketGatesMatch) {
        this.requireRole(request, url, 'viewer');
        this.respondJson(response, 200, await this.buildTicketGatesResponse(decodeURIComponent(ticketGatesMatch[1] ?? '')));
        return;
      }

      const ticketCommandMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/(retry|cancel|supersede|export-bundle|approve|reject|resume)$/);
      if (request.method === 'POST' && ticketCommandMatch) {
        const ticketId = decodeURIComponent(ticketCommandMatch[1] ?? '');
        const command = ticketCommandMatch[2] ?? '';
        await this.handleTicketCommand(request, response, url, ticketId, command);
        return;
      }

      this.respondJson(response, 404, { error: `Not found: ${url.pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      if (statusCode >= 500) {
        logger.error('UI request failed', { error: message });
      }
      this.respondJson(response, statusCode, { error: message });
    }
  }

  private async handleTicketCommand(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    ticketId: string,
    command: string
  ): Promise<void> {
    if (command === 'retry') {
      this.requireRole(request, url, 'operator');
      const payload = await this.readJsonBody(request, 8 * 1024);
      await this.repository.retryTicket(ticketId, {
        amendedDescription: optionalString(payload.amendedDescription),
      });
      await this.broadcastRefresh('ticket-retried');
      this.respondJson(response, 200, await this.buildTicketDetailResponse(ticketId));
      return;
    }

    if (command === 'cancel') {
      this.requireRole(request, url, 'operator');
      const payload = await this.readJsonBody(request, 8 * 1024);
      await this.repository.cancelTicket(ticketId, optionalString(payload.reason) ?? 'Cancelled by operator.');
      await this.broadcastRefresh('ticket-cancelled');
      this.respondJson(response, 200, await this.buildTicketDetailResponse(ticketId));
      return;
    }

    if (command === 'supersede') {
      this.requireRole(request, url, 'operator');
      const payload = await this.readJsonBody(request, 8 * 1024);
      await this.repository.supersedeTicket(ticketId, optionalString(payload.reason) ?? 'Superseded by newer work.');
      await this.broadcastRefresh('ticket-superseded');
      this.respondJson(response, 200, await this.buildTicketDetailResponse(ticketId));
      return;
    }

    if (command === 'export-bundle') {
      this.requireRole(request, url, 'operator');
      const payload = await this.readJsonBody(request, 8 * 1024);
      const bundle = await exportPatchBundle(this.repository, ticketId, {
        outputRoot: optionalString(payload.outputRoot),
      });
      await this.broadcastRefresh('ticket-bundle-exported');
      this.respondJson(response, 200, {
        delivery: bundle,
        detail: await this.buildTicketDetailResponse(ticketId),
      });
      return;
    }

    if (command === 'approve') {
      this.requireRole(request, url, 'approver');
      const payload = await this.readJsonBody(request, 8 * 1024);
      const reviewer = requireNonEmptyString(payload.reviewer, 'reviewer');
      const rationale = optionalString(payload.rationale) ?? 'Approved by operator.';
      await this.repository.approveTicket(ticketId, reviewer, rationale);
      await this.broadcastRefresh('ticket-approved');
      this.respondJson(response, 200, await this.buildTicketDetailResponse(ticketId));
      return;
    }

    if (command === 'reject') {
      this.requireRole(request, url, 'approver');
      const payload = await this.readJsonBody(request, 8 * 1024);
      const reviewer = requireNonEmptyString(payload.reviewer, 'reviewer');
      const rationale = optionalString(payload.rationale) ?? 'Rejected by operator.';
      await this.repository.rejectTicket(ticketId, reviewer, rationale);
      await this.broadcastRefresh('ticket-rejected');
      this.respondJson(response, 200, await this.buildTicketDetailResponse(ticketId));
      return;
    }

    if (command === 'resume') {
      this.requireRole(request, url, 'approver');
      await this.repository.resumeApprovedTicket(ticketId);
      await this.broadcastRefresh('ticket-resumed');
      this.respondJson(response, 200, await this.buildTicketDetailResponse(ticketId));
      return;
    }

    throw new HttpError(404, `Unsupported ticket command: ${command}`);
  }

  private async openEventStream(response: ServerResponse): Promise<void> {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    response.write(`event: ready\ndata: ${JSON.stringify({ server: this.serverName, revision: this.revisionStamp })}\n\n`);

    const client: SseClient = {
      id: `sse_${Math.random().toString(36).slice(2, 10)}`,
      response,
    };
    this.sseClients.add(client);

    response.on('close', () => {
      this.sseClients.delete(client);
    });
  }

  private startSsePolling(): void {
    if (this.ssePollTimer) {
      return;
    }

    this.ssePollTimer = setInterval(() => {
      void this.pollForStoreChanges();
    }, this.sseIntervalMs);
  }

  private async pollForStoreChanges(): Promise<void> {
    if (this.sseClients.size === 0) {
      return;
    }

    const nextRevision = await this.computeRevisionStamp();
    if (nextRevision !== this.revisionStamp) {
      this.revisionStamp = nextRevision;
      this.emitSseEvent('refresh', { revision: nextRevision });
      return;
    }

    this.emitSseEvent('heartbeat', { revision: nextRevision, at: new Date().toISOString() });
  }

  private async broadcastRefresh(reason: string): Promise<void> {
    this.revisionStamp = await this.computeRevisionStamp();
    this.emitSseEvent('refresh', {
      reason,
      revision: this.revisionStamp,
      at: new Date().toISOString(),
    });
  }

  private emitSseEvent(event: string, payload: Record<string, unknown>): void {
    for (const client of this.sseClients) {
      try {
        client.response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private async computeRevisionStamp(): Promise<string> {
    return (await this.repository.getRevisionStamp()).value;
  }

  private async buildSessionResponse(role: UIRole): Promise<Record<string, unknown>> {
    const permissions = getPermissionSet(role);

    return {
      role,
      permissions: Object.entries(permissions)
        .filter(([, enabled]) => enabled)
        .map(([permission]) => permission),
      commands: permissions,
      server: this.serverName,
      projectionEnabled: config.taskBoardProjectionEnabled,
      baselineAvailable: await fileExists(this.baselineFile),
    };
  }

  private async buildHealthResponse(): Promise<Record<string, unknown>> {
    return {
      status: 'ok',
      server: this.serverName,
      revision: this.revisionStamp,
      projectionEnabled: config.taskBoardProjectionEnabled,
      model: buildModelStatus(config),
      counts: await this.repository.getTicketCounts(),
      timestamp: new Date().toISOString(),
    };
  }

  private async loadStoreSnapshot(): Promise<StoreSnapshot> {
    const tickets = await this.repository.listTickets('all');
    const attemptsMap = await this.repository.listAttemptsForTickets(tickets.map((ticket) => ticket.id));
    const recentEvents = await this.repository.listRecentEvents({ limit: 24 });
    const lastBoardSyncAt = await this.repository.getLatestEventTimestamp('board-synced');
    const metrics = computeOperationalSLOMetrics({
      tickets,
      attemptsByTicket: attemptsMap,
      lastBoardSyncAt,
    });

    return {
      tickets,
      attemptsByTicket: attemptsMap,
      recentEvents,
      metrics,
    };
  }

  private async buildOverviewResponse(): Promise<Record<string, unknown>> {
    const snapshot = await this.loadStoreSnapshot();
    const efficiency = await readEfficiencySnapshot(this.efficiencySnapshotFile);
    const recentTickets = [...snapshot.tickets]
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, overviewRecentTicketLimit);
    const recentEvents = snapshot.recentEvents.slice(0, overviewRecentEventLimit);

    return {
      metadata: await this.buildPayloadMetadata({
        schemaVersion: 'overview.v1',
        windows: {
          recentTickets: overviewRecentTicketLimit,
          recentEvents: overviewRecentEventLimit,
        },
        baselineAvailable: await fileExists(this.baselineFile),
        efficiencySnapshotAvailable: Boolean(efficiency.timestamp),
      }),
      ticketCounts: buildTicketCounts(snapshot.tickets),
      metrics: snapshot.metrics,
      model: buildModelStatus(config),
      efficiency,
      recentTickets,
      recentEvents,
    };
  }

  private async buildModelStatusResponse(): Promise<Record<string, unknown>> {
    const inventory = await fetchOllamaModelInventory(config);
    const benchmark = await readLatestModelBenchmarkSummary(config.baseDir);
    const freshness = assessBenchmarkFreshness(benchmark);
    return {
      ...buildModelStatus(config, inventory),
      benchmark,
      benchmarkFreshness: freshness,
      promotionReadiness: {
        ready:
          benchmark.available === true &&
          typeof benchmark.successRate === 'number' &&
          typeof benchmark.caseCount === 'number' &&
          benchmark.caseCount >= 10 &&
          benchmark.successRate >= 0.75 &&
          freshness.status === 'fresh',
        thresholdSuccessRate: 0.75,
        minimumCaseCount: 10,
        benchmarkFreshnessHours: freshness.maxAgeHours,
      },
      inventory,
    };
  }

  private async buildTicketListResponse(searchParams: URLSearchParams): Promise<Record<string, unknown>> {
    const status = (searchParams.get('status') ?? 'all') as TaskStatus | 'all';
    const query = (searchParams.get('query') ?? '').trim().toLowerCase();
    const limit = clampNumber(searchParams.get('limit'), 200, 1, 500);
    const sourceTickets = status === 'all'
      ? await this.repository.listTickets('all')
      : await this.repository.listTickets(status);
    const tickets = sourceTickets
      .filter((ticket) => {
        if (!query) {
          return true;
        }

        return ticket.id.toLowerCase().includes(query) || ticket.description.toLowerCase().includes(query);
      })
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, limit);
    return { tickets };
  }

  private async buildTicketDetailResponse(ticketId: string): Promise<Record<string, unknown>> {
    const ticket = await this.repository.getTicket(ticketId);
    if (!ticket) {
      throw new HttpError(404, `Ticket not found: ${ticketId}`);
    }

    const attempts = await this.repository.listAttempts(ticketId);
    const attemptIds = new Set(attempts.map((attempt) => attempt.id));
    const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
    const workerVersions = (await this.repository.listWorkerVersions())
      .filter((workerVersion) => attemptIds.has(workerVersion.attemptId))
      .map((workerVersion) => {
        const attempt = attemptsById.get(workerVersion.attemptId);
        return {
          ...workerVersion,
          ticketId,
          attemptNumber: attempt?.attemptNumber ?? 0,
        } as TicketDetailWorkerVersion;
      });
    const workerVersionById = new Map(workerVersions.map((workerVersion) => [workerVersion.id, workerVersion]));
    const promotions = (await this.repository.listPromotionRecords())
      .filter((promotion) => workerVersionById.has(promotion.workerVersionId))
      .map((promotion) => {
        const workerVersion = workerVersionById.get(promotion.workerVersionId);
        const attempt = workerVersion ? attemptsById.get(workerVersion.attemptId) : undefined;
        return {
          ...promotion,
          ticketId,
          attemptId: workerVersion?.attemptId ?? '',
          attemptNumber: attempt?.attemptNumber ?? 0,
          workspaceId: workerVersion?.workspaceId,
          workspaceRoot: workerVersion?.workspaceRoot,
          isolationMode: attempt?.isolationMode,
          patchBundlePath: workerVersion?.patchBundlePath,
          verificationSummary: workerVersion?.verificationSummary,
          workerVersionStatus: workerVersion?.status,
        } as TicketDetailPromotion;
      });
    const events = await this.repository.listEvents(ticketId);
    const sideEffects = await this.repository.listTaskSideEffects(ticketId);
    const artifacts = flattenArtifacts(attempts);
    const policySnapshots = extractPolicySnapshots(attempts);
    const patchDeltas = extractPatchDeltas(attempts);
    const recoveryRecommendation = deriveRecoveryRecommendation(ticket, attempts);

    return {
      ticket,
      attempts,
      workerVersions,
      promotions,
      events,
      sideEffects,
      derived: {
        artifacts,
        policySnapshots,
        patchDeltas,
        recoveryRecommendation,
        currentPatch: extractPatchFromToolCalls(ticket.toolCalls),
      },
    };
  }

  private async buildTicketTimelineResponse(ticketId: string): Promise<Record<string, unknown>> {
    const ticket = await this.repository.getTicket(ticketId);
    if (!ticket) {
      throw new HttpError(404, `Ticket not found: ${ticketId}`);
    }

    const attempts = await this.repository.listAttempts(ticketId);
    const events = await this.repository.listEvents(ticketId);
    const attemptIds = new Set(attempts.map((attempt) => attempt.id));
    const workerVersions = (await this.repository.listWorkerVersions())
      .filter((workerVersion) => attemptIds.has(workerVersion.attemptId));
    const workerVersionById = new Map(workerVersions.map((workerVersion) => [workerVersion.id, workerVersion]));
    const workerVersionIds = new Set(workerVersions.map((workerVersion) => workerVersion.id));
    const promotions = (await this.repository.listPromotionRecords())
      .filter((promotion) => workerVersionIds.has(promotion.workerVersionId));

    const entries: TicketTimelineEntry[] = [];

    for (const event of events) {
      entries.push({
        at: event.createdAt.toISOString(),
        source: `event.${event.type}`,
        detail: event.details ?? '-',
      });
    }

    for (const attempt of attempts) {
      entries.push({
        at: attempt.startedAt.toISOString(),
        source: 'attempt.started',
        detail: `${attempt.id} #${attempt.attemptNumber}`,
      });

      if (attempt.endedAt) {
        entries.push({
          at: attempt.endedAt.toISOString(),
          source: 'attempt.ended',
          detail: `${attempt.id} status=${attempt.status}`,
        });
      }
    }

    for (const workerVersion of workerVersions) {
      entries.push({
        at: workerVersion.createdAt.toISOString(),
        source: 'worker-version.created',
        detail: `${workerVersion.id} attempt=${workerVersion.attemptId} status=${workerVersion.status}`,
      });

      if (workerVersion.activatedAt) {
        entries.push({
          at: workerVersion.activatedAt.toISOString(),
          source: 'worker-version.activated',
          detail: `${workerVersion.id} status=${workerVersion.status}`,
        });
      }
    }

    for (const promotion of promotions) {
      entries.push({
        at: promotion.requestedAt.toISOString(),
        source: 'promotion.requested',
        detail: `${promotion.id} worker=${promotion.workerVersionId} status=${promotion.status}`,
      });

      const workerVersion = workerVersionById.get(promotion.workerVersionId);
      entries.push({
        at: promotion.updatedAt.toISOString(),
        source: 'promotion.updated',
        detail: `${promotion.id} worker=${promotion.workerVersionId} version=${workerVersion?.status ?? '-'} status=${promotion.status}`,
      });
    }

    entries.sort((left, right) => left.at.localeCompare(right.at));

    return {
      metadata: await this.buildPayloadMetadata({
        schemaVersion: 'ticket-timeline.v1',
        windows: {
          recentTickets: 1,
          recentEvents: entries.length,
        },
        baselineAvailable: await fileExists(this.baselineFile),
        efficiencySnapshotAvailable: await fileExists(this.efficiencySnapshotFile),
      }),
      ticket: {
        id: ticket.id,
        status: ticket.status,
      },
      entries,
    };
  }

  private async buildTicketEvidenceResponse(ticketId: string): Promise<Record<string, unknown>> {
    const ticket = await this.repository.getTicket(ticketId);
    if (!ticket) {
      throw new HttpError(404, `Ticket not found: ${ticketId}`);
    }

    const attempts = await this.repository.listAttempts(ticketId);
    const sideEffects = await this.repository.listTaskSideEffects(ticketId);
    const artifacts = flattenArtifacts(attempts);
    const policySnapshots = extractPolicySnapshots(attempts);
    const patchDeltas = extractPatchDeltas(attempts);

    return {
      metadata: await this.buildPayloadMetadata({
        schemaVersion: 'ticket-evidence.v1',
        windows: {
          recentTickets: 1,
          recentEvents: artifacts.length,
        },
        baselineAvailable: await fileExists(this.baselineFile),
        efficiencySnapshotAvailable: await fileExists(this.efficiencySnapshotFile),
      }),
      ticket: {
        id: ticket.id,
        status: ticket.status,
      },
      evidence: {
        currentPatch: extractPatchFromToolCalls(ticket.toolCalls),
        artifacts,
        policySnapshots,
        patchDeltas,
        sideEffects,
      },
    };
  }

  private async buildTicketGatesResponse(ticketId: string): Promise<Record<string, unknown>> {
    const ticket = await this.repository.getTicket(ticketId);
    if (!ticket) {
      throw new HttpError(404, `Ticket not found: ${ticketId}`);
    }

    const attempts = await this.repository.listAttempts(ticketId);
    const patchDeltas = extractPatchDeltas(attempts);
    const intendedFiles = Array.isArray(ticket.plan?.intendedFiles)
      ? ticket.plan.intendedFiles
      : [];
    const mutableTargets = intendedFiles
      .filter((file) => file && file.changeType !== 'inspect' && typeof file.path === 'string')
      .map((file) => file.path);

    const observedMutations: string[] = [];
    for (const delta of patchDeltas) {
      const applyState = String(delta.apply ?? '').toLowerCase();
      if (!applyState.startsWith('success')) {
        continue;
      }

      for (const pathValue of delta.mutatedPaths) {
        if (!observedMutations.includes(pathValue)) {
          observedMutations.push(pathValue);
        }
      }
    }

    const normalizedObserved = observedMutations.map((value) => normalizePath(value));
    const hasTargetIntersection = mutableTargets
      .map((value) => normalizePath(value))
      .some((candidate) => normalizedObserved.includes(candidate));
    const errorText = typeof ticket.error === 'string' ? ticket.error : '';
    const failedEvidenceGate = /No governed mutation evidence|do not intersect mutable intended files|Completion requires/i.test(errorText);

    let gateStatus = 'pending evidence';
    if (mutableTargets.length === 0) {
      gateStatus = 'no mutable targets';
    } else if (failedEvidenceGate) {
      gateStatus = 'failed evidence gate';
    } else if (hasTargetIntersection) {
      gateStatus = 'mutation evidence present';
    } else if (ticket.status === 'completed') {
      gateStatus = 'completed without visible mutation evidence';
    }

    return {
      metadata: await this.buildPayloadMetadata({
        schemaVersion: 'ticket-gates.v1',
        windows: {
          recentTickets: 1,
          recentEvents: patchDeltas.length,
        },
        baselineAvailable: await fileExists(this.baselineFile),
        efficiencySnapshotAvailable: await fileExists(this.efficiencySnapshotFile),
      }),
      ticket: {
        id: ticket.id,
        status: ticket.status,
      },
      completionEvidence: {
        gateStatus,
        mutableTargets,
        observedMutations,
        gateReason: failedEvidenceGate ? errorText : '-',
      },
      recoveryRecommendation: deriveRecoveryRecommendation(ticket, attempts),
    };
  }

  private async buildApprovalQueueResponse(): Promise<Record<string, unknown>> {
    const tickets = await this.repository.listTickets('awaiting_approval');
    const attemptsByTicket = await this.repository.listAttemptsForTickets(
      tickets.map((ticket) => ticket.id)
    );
    const items = await Promise.all(
      tickets.map(async (ticket) => {
        const attempts = attemptsByTicket.get(ticket.id) ?? [];
        const policySnapshots = extractPolicySnapshots(attempts);
        const patchDeltas = extractPatchDeltas(attempts);
        return {
          ticket,
          currentPatch: extractPatchFromToolCalls(ticket.toolCalls),
          policySnapshots,
          patchDeltas,
          patchDeltaSummary: patchDeltas[0]
            ? `${patchDeltas[0].subject} | dry-run=${patchDeltas[0].dryRun} | apply=${patchDeltas[0].apply}`
            : undefined,
        } satisfies ApprovalQueueItem;
      })
    );

    return {
      items: items.sort((left, right) => right.ticket.updatedAt.getTime() - left.ticket.updatedAt.getTime()),
    };
  }

  private async buildReliabilityResponse(): Promise<Record<string, unknown>> {
    const snapshot = await this.loadStoreSnapshot();
    const baseline = await readBaselineSnapshot(this.baselineFile);
    const efficiency = await readEfficiencySnapshot(this.efficiencySnapshotFile);

    return {
      metadata: await this.buildPayloadMetadata({
        schemaVersion: 'reliability.v1',
        windows: {
          recentTickets: 0,
          recentEvents: reliabilityRecentEventLimit,
        },
        baselineAvailable: baseline.markdown.trim().length > 0,
        efficiencySnapshotAvailable: Boolean(efficiency.timestamp),
      }),
      metrics: snapshot.metrics,
      comparisons: buildMetricComparisons(snapshot.metrics, baseline.values),
      baseline,
      efficiency,
      recentEvents: snapshot.recentEvents.slice(0, reliabilityRecentEventLimit),
    };
  }

  private async buildPayloadMetadata(input: {
    schemaVersion: string;
    windows: { recentTickets: number; recentEvents: number };
    baselineAvailable: boolean;
    efficiencySnapshotAvailable: boolean;
  }): Promise<PayloadMetadata> {
    return {
      schemaVersion: input.schemaVersion,
      generatedAt: new Date().toISOString(),
      revision: this.revisionStamp || await this.computeRevisionStamp(),
      windows: input.windows,
      sources: {
        baselineAvailable: input.baselineAvailable,
        efficiencySnapshotAvailable: input.efficiencySnapshotAvailable,
      },
    };
  }

  private requireRole(request: IncomingMessage, url: URL, minimumRole: UIRole): UIRole {
    const token = readAuthToken(request, url);
    if (!token) {
      throw new HttpError(401, 'Missing access token.');
    }

    const matchedToken = this.authTokens.find((candidate) => candidate.token === token);
    if (!matchedToken) {
      throw new HttpError(401, 'Invalid access token.');
    }

    if (roleRank[matchedToken.role] < roleRank[minimumRole]) {
      throw new HttpError(403, `Role ${matchedToken.role} does not have permission for this action.`);
    }

    return matchedToken.role;
  }

  private respondHtml(response: ServerResponse, html: string): void {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    response.end(html);
  }

  private respondJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(JSON.stringify(payload));
  }

  private async readJsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        throw new HttpError(413, `Request body exceeded ${maxBytes} bytes.`);
      }

      chunks.push(buffer);
    }

    if (chunks.length === 0) {
      return {};
    }

    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON.');
    }
  }
}

class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}

function getEnv(key: string, defaultValue = ''): string {
  return process.env[key] ?? defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseUITokens(raw: string): UIAuthToken[] {
  const entries = raw
    .split(/[;,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return [{
      role: 'admin',
      token: defaultAdminToken,
      label: 'Local admin',
    }];
  }

  return entries.map((entry, index) => {
    const [roleCandidate, tokenCandidate, ...labelParts] = entry.split(':').map((value) => value.trim());
    if (!roleCandidate || !tokenCandidate) {
      throw new Error(`Invalid UI_TOKENS entry at position ${index + 1}. Expected role:token[:label].`);
    }

    if (!isUIRole(roleCandidate)) {
      throw new Error(`Invalid UI role in UI_TOKENS: ${roleCandidate}`);
    }

    return {
      role: roleCandidate,
      token: tokenCandidate,
      label: labelParts.join(':') || `${roleCandidate} token`,
    } satisfies UIAuthToken;
  });
}

function isUIRole(value: string): value is UIRole {
  return value === 'viewer' || value === 'operator' || value === 'approver' || value === 'admin';
}

function getPermissionSet(role: UIRole): UIPermissionSet {
  return {
    query: roleRank[role] >= roleRank.viewer,
    create: roleRank[role] >= roleRank.operator,
    retry: roleRank[role] >= roleRank.operator,
    cancel: roleRank[role] >= roleRank.operator,
    supersede: roleRank[role] >= roleRank.operator,
    exportBundle: roleRank[role] >= roleRank.operator,
    approve: roleRank[role] >= roleRank.approver,
    reject: roleRank[role] >= roleRank.approver,
    resume: roleRank[role] >= roleRank.approver,
  };
}

function buildTicketCounts(tickets: TaskTicket[]): Record<string, number> {
  const counts: Record<string, number> = { total: tickets.length };
  for (const ticket of tickets) {
    counts[ticket.status] = (counts[ticket.status] ?? 0) + 1;
  }
  return counts;
}

function normalizePath(pathValue: string): string {
  return String(pathValue || '').replace(/\\/g, '/').trim().toLowerCase();
}

function readAuthToken(request: IncomingMessage, url: URL): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  const queryToken = url.searchParams.get('token');
  return queryToken?.trim() || null;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) {
    throw new HttpError(400, `Field "${fieldName}" must be a non-empty string.`);
  }

  return candidate;
}

function optionalString(value: unknown): string | undefined {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return candidate || undefined;
}

function clampNumber(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function flattenArtifacts(attempts: TaskAttempt[]): FlattenedArtifact[] {
  return attempts.flatMap((attempt) =>
    attempt.artifacts.map((artifact) => ({
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      raw: artifact,
    }))
  );
}

function extractPatchFromToolCalls(toolCalls: ToolCall[] | undefined): string | undefined {
  const patchCall = toolCalls?.find((toolCall) => toolCall.name === 'patch.apply');
  return typeof patchCall?.arguments.patch === 'string' ? patchCall.arguments.patch : undefined;
}

function extractPolicySnapshots(attempts: TaskAttempt[]): PolicySnapshotArtifact[] {
  const results: PolicySnapshotArtifact[] = [];

  for (const attempt of attempts) {
    for (const artifact of attempt.artifacts) {
      const match = artifact.match(/^\[(?<correlation>[^\]]+)\] policy\.snapshot \[(?<signature>[^\]]+)\] (?<payload>.+)$/);
      if (!match?.groups) {
        continue;
      }

      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(match.groups.payload) as Record<string, unknown>;
      } catch {
        parsed = undefined;
      }

      results.push({
        raw: artifact,
        correlationId: match.groups.correlation,
        signature: match.groups.signature,
        parsed,
      });
    }
  }

  return results;
}

function extractPatchDeltas(attempts: TaskAttempt[]): PatchDeltaArtifact[] {
  const results: PatchDeltaArtifact[] = [];

  for (const attempt of attempts) {
    for (const artifact of attempt.artifacts) {
      const match = artifact.match(/^\[(?<correlation>[^\]]+)\] patch\.delta (?<subject>.+?): dry-run=(?<dryRun>[^;]+); apply=(?<apply>[^;]+); mutatedPaths=(?<paths>.*)$/);
      if (!match?.groups) {
        continue;
      }

      const mutatedPaths = match.groups.paths && match.groups.paths !== '-'
        ? match.groups.paths.split(',').map((value) => value.trim()).filter(Boolean)
        : [];

      results.push({
        raw: artifact,
        correlationId: match.groups.correlation,
        subject: match.groups.subject,
        dryRun: match.groups.dryRun,
        apply: match.groups.apply,
        mutatedPaths,
      });
    }
  }

  return results;
}

async function readBaselineSnapshot(filePath: string): Promise<BaselineSnapshot> {
  try {
    const markdown = await readFile(filePath, 'utf-8');
    const values: Record<string, string> = {};
    for (const line of markdown.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9 \-()]+):\s+(.+)$/);
      if (match) {
        values[match[1].trim()] = match[2].trim();
      }
    }

    return { markdown, values };
  } catch {
    return { markdown: '', values: {} };
  }
}

async function readEfficiencySnapshot(filePath: string): Promise<EfficiencySnapshot> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as EfficiencySnapshot;
  } catch {
    return {};
  }
}

function buildMetricComparisons(
  metrics: OperationalSLOMetrics,
  baselineValues: Record<string, string>
): Array<{ label: string; current: string; baseline: string }> {
  const rows = [
    ['State consistency lag (ms)', String(metrics.stateConsistencyLagMs)],
    ['Average admission-to-start latency (ms)', metrics.averageAdmissionToStartLatencyMs.toFixed(2)],
    ['Blocked-retry success ratio', metrics.blockedRetrySuccessRatio.toFixed(2)],
    ['Execution failure taxonomy stability', metrics.executionFailureTaxonomyStability.toFixed(2)],
    ['Awaiting approval tickets', String(metrics.awaitingApprovalTickets)],
  ] as const;

  return rows.map(([label, current]) => ({
    label,
    current,
    baseline: baselineValues[label] ?? '-',
  }));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const server = new UIServer();
  await server.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`UI shutdown requested: ${signal}`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  main().catch(async (error) => {
    logger.error('UI server failed', { error: String(error) });
    process.exit(1);
  });
}
