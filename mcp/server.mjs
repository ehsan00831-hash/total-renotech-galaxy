#!/usr/bin/env node
/**
 * TotalRENOTech Operations — Claude MCP server.
 *
 * Exposes the operations API as MCP tools over stdio. Every tool is a thin,
 * validated call to the same HTTP endpoints the web app uses, so behaviour,
 * de-duplication and the audit trail are identical across all three clients.
 *
 * Run:
 *   TRT_API_BASE=https://your-deployment TRT_API_TOKEN=... node mcp/server.mjs
 *
 * Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "trt-ops": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/mcp/server.mjs"],
 *         "env": { "TRT_API_BASE": "https://...", "TRT_API_TOKEN": "..." }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';

const BASE = (process.env.TRT_API_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.TRT_API_TOKEN ?? '';

if (!TOKEN) {
  process.stderr.write(
    'TRT_API_TOKEN is not set. Every write will be rejected with 401.\n',
  );
}

async function call(path, { method = 'GET', body, idempotencyKey } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      'x-trt-source': 'claude',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: text.slice(0, 400) }; }
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json;
}

/** Stable, order-insensitive JSON so equal payloads hash equal. */
function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
  }
  if (typeof value === 'string') return JSON.stringify(value.trim());
  return JSON.stringify(value);
}

/**
 * Deterministic idempotency key.
 *
 * The same tool call with the same arguments always produces the same key, so a
 * dropped response that Claude retries cannot create a second record. Different
 * arguments hash differently, so a genuine follow-up edit still goes through.
 */
function idem(action, payload) {
  const material = 'claude|' + action + '|' + canonicalJson(payload);
  return 'sk_' + createHash('sha256').update(material).digest('hex').slice(0, 32);
}

const str = (d) => ({ type: 'string', description: d });
const strArr = (d) => ({ type: 'array', items: { type: 'string' }, description: d });

const TOOLS = [
  {
    name: 'search_jobs',
    description:
      'Search and filter jobs. Use view to pick a saved list, or q for free text ' +
      'across customer, WO, PO, address and scope.',
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: ['all', 'upcoming', 'tomorrow', 'ongoing', 'waiting-materials',
            'waiting-approval', 'completed', 'cancelled', 'long-projects',
            'unassigned', 'overdue'],
        },
        q: str('Free text search'),
        status: str('Exact status filter'),
        priority: str('Exact priority filter'),
        tech: str('Technician name'),
        truck: str('Truck number'),
      },
    },
  },
  {
    name: 'get_today_plan',
    description: 'KPIs, today schedule, urgent alerts and material blockers.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_open_reminders',
    description: 'Outstanding reminders, overdue first.',
    inputSchema: {
      type: 'object',
      properties: {
        which: { type: 'string', enum: ['active', 'archive', 'both'] },
      },
    },
  },
  {
    name: 'create_or_update_job',
    description:
      'Create a job, or update the matching one. Matching runs on Job ID, WO, PO, ' +
      'then customer plus address, so a repeat call never duplicates a record. ' +
      'Send only fields you actually know — omit anything unknown.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: str('Existing job identifier, when known'),
        customer: str('Customer or store name, verbatim'),
        projectType: str('NATIONAL PROJECT | PRIVATE | INTERNAL | WARRANTY'),
        fullAddress: str(
          'One line, city included, e.g. "225 Rue Peel, Montreal, QC". ' +
          'Do not split it and do not repeat the city.',
        ),
        contactName: str('Site contact'),
        phone: str('Phone'),
        email: str('Email'),
        woNumber: str('Work order number'),
        poNumber: str('Purchase order number'),
        scope: str('Scope of work'),
        priority: str('LOW | NORMAL | HIGH | URGENT | EMERGENCY'),
        status: str('Job status'),
        scheduledDate: str('YYYY-MM-DD'),
        arrivalWindow: str('Arrival time'),
        truck: str('Truck number'),
        technicians: strArr('Up to five technician names'),
        materials: str('Materials needed'),
        materialStatus: str('NONE | NEED LIST | NEED PURCHASE | ORDERED | READY | DELIVERED | USED'),
        followUpDate: str('YYYY-MM-DD'),
        notes: str('Internal notes'),
      },
    },
  },
  {
    name: 'update_job_status',
    description: 'Change one job status. Destination views follow automatically.',
    inputSchema: {
      type: 'object',
      required: ['jobId', 'status'],
      properties: { jobId: str('Job identifier'), status: str('New status') },
    },
  },
  {
    name: 'assign_crew',
    description: 'Set the technicians on a job. Replaces the current crew.',
    inputSchema: {
      type: 'object',
      required: ['jobId', 'technicians'],
      properties: {
        jobId: str('Job identifier'),
        technicians: strArr('Up to five names, from the Team & Fleet roster'),
      },
    },
  },
  {
    name: 'assign_truck',
    description: 'Set the truck on a job.',
    inputSchema: {
      type: 'object',
      required: ['jobId', 'truck'],
      properties: { jobId: str('Job identifier'), truck: str('Truck number') },
    },
  },
  {
    name: 'add_material',
    description: 'Record a material requirement against a job.',
    inputSchema: {
      type: 'object',
      required: ['jobId', 'materials'],
      properties: {
        jobId: str('Job identifier'),
        materials: str('Material description'),
        materialStatus: str('NEED LIST | NEED PURCHASE | ORDERED | READY | DELIVERED | USED'),
      },
    },
  },
  {
    name: 'complete_job',
    description: 'Mark a job COMPLETED and stamp the completion date.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: str('Job identifier'),
        notes: str('Closing notes'),
      },
    },
  },
  {
    name: 'create_or_update_reminder',
    description:
      'Add or update a reminder. Same customer plus same required action merges ' +
      'into the existing one. COMPLETED, CANCELLED and REMOVED route to ARCHIVE.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('Reminder id, when updating'),
        category: str('Reminder category'),
        customer: str('Customer or project'),
        requiredAction: str('What must be done'),
        assignedTo: str('Owner'),
        priority: { type: 'string', enum: ["Critical","High","Normal","Low"], description: 'Reminder priority, exact spelling' },
        status: { type: 'string', enum: ["New","Action Required","In Progress","Scheduled","Follow-Up Required","Waiting for Response","Waiting for Payment","Waiting for Approval","Completed — Check Required","Completed","On Hold","Cancelled","Removed"], description: 'Reminder status, exact spelling. Completed, Cancelled and Removed surface in ARCHIVE via its formula.' },
        dueAt: str('Due date and time'),
        nextFollowUp: str('Next follow-up date'),
        contactAddress: str('Contact and address'),
        reference: str('Related file or reference'),
        amount: str('Amount in CAD'),
        waitingFor: str('What is being waited on'),
        notes: str('Notes or links'),
      },
    },
  },
  {
    name: 'add_daily_log',
    description:
      'Add one working day to a project. Person-hours are computed as ' +
      'crew size x ((clock out - clock in) - break).',
    inputSchema: {
      type: 'object',
      required: ['workDate'],
      properties: {
        jobId: str('Job identifier'),
        project: str('Project name'),
        workDate: str('YYYY-MM-DD'),
        location: str('Site'),
        truck: str('Truck number'),
        technicians: strArr('Crew on site, up to five'),
        clockIn: str('HH:MM'),
        clockOut: str('HH:MM'),
        breakMin: { type: 'number', description: 'Break in minutes' },
        workCompleted: str('What was done'),
        materialsUsed: str('Materials consumed'),
        issues: str('Problems or delays'),
        nextStep: str('Next required action'),
        supervisor: str('Supervisor'),
      },
    },
  },
  {
    name: 'submit_message',
    description:
      'Send a raw operations message in English, French, Persian or Finglish and ' +
      'let the server decide the action. Returns a parsed preview; call again ' +
      'with confirm true to apply it.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: str('The raw message'),
        confirm: { type: 'boolean', description: 'Apply it rather than previewing' },
        idempotencyKey: str('Reuse the key from the preview when confirming'),
      },
    },
  },
];

const server = new Server(
  { name: 'trt-ops', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    let result;
    switch (name) {
      case 'search_jobs': {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(args)) if (v) qs.set(k, String(v));
        result = await call(`/api/jobs?${qs.toString()}`);
        break;
      }
      case 'get_today_plan':
        result = await call('/api/dashboard');
        break;
      case 'get_open_reminders':
        result = await call(`/api/reminders?which=${args.which ?? 'active'}`);
        break;
      case 'create_or_update_job':
        result = await call('/api/jobs', { method: 'POST', body: args, idempotencyKey: idem('create_or_update_job', args) });
        break;
      case 'update_job_status':
        result = await call('/api/jobs', {
          method: 'POST',
          body: { jobId: args.jobId, status: args.status },
          idempotencyKey: idem('update_job_status', { jobId: args.jobId, status: args.status }),
        });
        break;
      case 'assign_crew':
        result = await call('/api/jobs', {
          method: 'POST',
          body: { jobId: args.jobId, technicians: args.technicians },
          idempotencyKey: idem('assign_crew', { jobId: args.jobId, technicians: args.technicians }),
        });
        break;
      case 'assign_truck':
        result = await call('/api/jobs', {
          method: 'POST',
          body: { jobId: args.jobId, truck: args.truck },
          idempotencyKey: idem('assign_truck', { jobId: args.jobId, truck: args.truck }),
        });
        break;
      case 'add_material':
        result = await call('/api/jobs', {
          method: 'POST',
          body: {
            jobId: args.jobId,
            materials: args.materials,
            materialStatus: args.materialStatus ?? 'NEED LIST',
          },
          idempotencyKey: idem('add_material', { jobId: args.jobId, materials: args.materials, materialStatus: args.materialStatus }),
        });
        break;
      case 'complete_job':
        result = await call('/api/jobs', {
          method: 'POST',
          body: { jobId: args.jobId, status: 'COMPLETED', notes: args.notes },
          idempotencyKey: idem('complete_job', { jobId: args.jobId }),
        });
        break;
      case 'create_or_update_reminder':
        result = await call('/api/reminders', {
          method: 'POST', body: args, idempotencyKey: idem('create_or_update_reminder', args),
        });
        break;
      case 'add_daily_log':
        result = await call('/api/logs', {
          method: 'POST', body: args, idempotencyKey: idem('add_daily_log', args),
        });
        break;
      case 'submit_message':
        result = await call('/api/ai/intake', {
          method: 'POST',
          body: {
            source: 'claude',
            message: args.message,
            confirm: Boolean(args.confirm),
            idempotencyKey: args.idempotencyKey ?? idem('submit_message', { message: args.message }),
          },
        });
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`trt-ops MCP server ready against ${BASE}\n`);
