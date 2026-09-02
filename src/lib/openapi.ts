/**
 * OpenAPI 3.1 description of the operations API.
 *
 * Kept as a module so the live route and the emitted openapi.json come from
 * one source and cannot drift apart.
 */

export function buildSpec(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'TotalRENOTech Operations API',
      version: '1.0.0',
      description:
        'Read and update the TotalRENOTech operations workbook. Writes are ' +
        'validated, de-duplicated and audited. Send an Idempotency-Key header ' +
        'on any write so a retry cannot create a second record.',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Job: {
          type: 'object',
          properties: {
            jobId: { type: 'string' }, customer: { type: 'string' },
            projectType: { type: 'string' }, fullAddress: { type: 'string' },
            contactName: { type: 'string' }, phone: { type: 'string' },
            woNumber: { type: 'string' }, poNumber: { type: 'string' },
            scope: { type: 'string' }, priority: { type: 'string' },
            status: { type: 'string' }, scheduledDate: { type: 'string' },
            projectEnd: { type: 'string', description: 'Completion date' },
            truck: { type: 'string' },
            technicians: { type: 'array', items: { type: 'string' } },
            materials: { type: 'string' }, materialStatus: { type: 'string' },
            totalHours: { type: 'number' }, row: { type: 'integer' },
          },
        },
        JobUpsert: {
          type: 'object',
          description: 'Only send fields you actually know. Omit anything unknown.',
          properties: {
            jobId: { type: 'string' }, customer: { type: 'string' },
            projectType: { type: 'string' },
            fullAddress: {
              type: 'string',
              description: 'One line, city included. Never split, never repeat the city.',
            },
            contactName: { type: 'string' }, phone: { type: 'string' },
            email: { type: 'string' }, woNumber: { type: 'string' },
            poNumber: { type: 'string' }, scope: { type: 'string' },
            priority: {
              type: 'string',
              enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'EMERGENCY'],
            },
            status: {
              type: 'string',
              enum: ['NEW LEAD', 'NEED INFO', 'NEED SCHEDULING', 'UPCOMING',
                'TOMORROW PLAN', 'SCHEDULED', 'ONGOING', 'WAITING MATERIAL',
                'WAITING APPROVAL', 'NEED FOLLOW-UP', 'ON HOLD', 'DONE',
                'COMPLETED', 'CANCELLED'],
            },
            scheduledDate: { type: 'string', description: 'YYYY-MM-DD' },
            arrivalWindow: { type: 'string' },
            truck: { type: 'string' },
            technicians: { type: 'array', items: { type: 'string' }, maxItems: 5 },
            materials: { type: 'string' }, materialStatus: { type: 'string' },
            followUpDate: { type: 'string' }, notes: { type: 'string' },
          },
        },
        Reminder: {
          type: 'object',
          properties: {
            id: { type: 'string' }, category: { type: 'string' },
            customer: { type: 'string' }, requiredAction: { type: 'string' },
            assignedTo: { type: 'string' },
            priority: { type: 'string', enum: ["Critical","High","Normal","Low"] },
            status: { type: 'string', enum: ["New","Action Required","In Progress","Scheduled","Follow-Up Required","Waiting for Response","Waiting for Payment","Waiting for Approval","Completed — Check Required","Completed","On Hold","Cancelled","Removed"] },
            dueAt: { type: 'string' },
            amount: { type: 'string' }, overdue: { type: 'boolean' },
          },
        },
        Error: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, error: { type: 'string' } },
        },
      },
    },
    paths: {
      '/api/jobs': {
        get: {
          operationId: 'searchJobs',
          summary: 'Search and filter jobs',
          parameters: [
            { name: 'view', in: 'query', schema: { type: 'string',
              enum: ['all', 'upcoming', 'tomorrow', 'scheduled', 'ongoing', 'waiting',
                'waiting-materials', 'waiting-approval', 'urgent', 'completed', 'cancelled',
                'long-projects', 'unassigned', 'overdue'] } },
            { name: 'q', in: 'query', schema: { type: 'string' },
              description: 'Free text across customer, WO, PO, address and scope' },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'priority', in: 'query', schema: { type: 'string' } },
            { name: 'projectType', in: 'query', schema: { type: 'string' } },
            { name: 'tech', in: 'query', schema: { type: 'string' } },
            { name: 'truck', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Matching jobs',
              content: { 'application/json': { schema: { type: 'object', properties: {
                ok: { type: 'boolean' }, count: { type: 'integer' },
                jobs: { type: 'array', items: { $ref: '#/components/schemas/Job' } } } } } } },
          },
        },
        post: {
          operationId: 'createOrUpdateJob',
          summary: 'Create a job, or update the matching one',
          description:
            'Matches an existing job by Job ID, WO, PO, then customer plus address. ' +
            'When a match is found the job is updated instead of duplicated.',
          parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
          requestBody: { required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JobUpsert' } } } },
          responses: {
            200: { description: 'Created or updated' },
            422: { description: 'Validation failed',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/jobs/{jobId}': {
        // No path-level `parameters` here: the GPT Actions importer does not
        // recognise a path item's own `parameters` property and skips the
        // whole path with "unrecognized method parameters" when it sees one.
        // jobId is declared on the one operation that still needs it.
        //
        // PATCH updateJob is intentionally absent from this schema — Actions
        // only exposes GET here. The real PATCH /api/jobs/{jobId} route is
        // untouched and still live; createOrUpdateJob (POST /api/jobs) is
        // Actions' path for every job create and update.
        get: {
          operationId: 'getJob',
          summary: 'One job with its daily logs and roll-up',
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Job detail' }, 404: { description: 'Not found' } },
        },
      },
      '/api/reminders': {
        get: {
          operationId: 'getReminders',
          summary: 'Outstanding reminders, overdue first',
          parameters: [{ name: 'which', in: 'query',
            schema: { type: 'string', enum: ['active', 'archive', 'both'] } }],
          responses: { 200: { description: 'Reminders',
            content: { 'application/json': { schema: { type: 'object', properties: {
              reminders: { type: 'array', items: { $ref: '#/components/schemas/Reminder' } },
              overdue: { type: 'integer' },
              groups: {
                type: 'object', nullable: true,
                description:
                  'Present when which=active: the same reminders bucketed as ' +
                  'overdue, dueToday, dueTomorrow, scheduled, followUp, waiting, other.',
              } } } } } } },
        },
        post: {
          operationId: 'createOrUpdateReminder',
          summary: 'Add or update a reminder',
          description:
            'Same customer plus same required action is treated as the same ' +
            'reminder and merged. Completed, Cancelled and Removed route to ARCHIVE.',
          parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              id: { type: 'string' }, category: { type: 'string' },
              customer: { type: 'string' }, requiredAction: { type: 'string' },
              assignedTo: { type: 'string' },
              priority: { type: 'string', enum: ["Critical","High","Normal","Low"] },
              status: { type: 'string', enum: ["New","Action Required","In Progress","Scheduled","Follow-Up Required","Waiting for Response","Waiting for Payment","Waiting for Approval","Completed — Check Required","Completed","On Hold","Cancelled","Removed"] },
              dueAt: { type: 'string' },
              nextFollowUp: { type: 'string' }, contactAddress: { type: 'string' },
              reference: { type: 'string' }, amount: { type: 'string' },
              waitingFor: { type: 'string' }, notes: { type: 'string' },
            } } } } },
          responses: { 200: { description: 'Created, updated or moved' } },
        },
      },
      '/api/materials': {
        get: {
          operationId: 'getMaterials',
          summary: 'Jobs that need materials, still linked to the job',
          responses: { 200: { description: 'Material lines' } },
        },
      },
      '/api/logs': {
        get: {
          operationId: 'getDailyLogs',
          summary: 'Daily logs, optionally for one job',
          parameters: [{ name: 'jobId', in: 'query', schema: { type: 'string' } }],
          responses: { 200: { description: 'Logs and roll-up' } },
        },
        post: {
          operationId: 'addDailyLog',
          summary: 'Add or replace one working day on a project',
          description:
            'Person-hours are computed as crew size x ((clock out - clock in) - break).',
          parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['workDate'],
            properties: {
              jobId: { type: 'string' }, project: { type: 'string' },
              workDate: { type: 'string' }, location: { type: 'string' },
              truck: { type: 'string' },
              technicians: { type: 'array', items: { type: 'string' }, maxItems: 5 },
              clockIn: { type: 'string' }, clockOut: { type: 'string' },
              breakMin: { type: 'number' }, workCompleted: { type: 'string' },
              materialsUsed: { type: 'string' }, issues: { type: 'string' },
              nextStep: { type: 'string' }, supervisor: { type: 'string' },
            } } } } },
          responses: { 200: { description: 'Log written' } },
        },
      },
      '/api/team': {
        get: {
          operationId: 'getTeamAndFleet',
          summary: 'Personnel and vehicles, plus valid crew and truck options',
          responses: { 200: { description: 'Roster and fleet' } },
        },
      },
      '/api/dashboard': {
        get: {
          operationId: 'getTodayPlan',
          summary: 'KPIs, today plan, urgent alerts and chart series',
          responses: { 200: { description: 'Dashboard payload' } },
        },
      },
      '/api/ai/intake': {
        post: {
          operationId: 'submitMessage',
          summary: 'Turn a free-text message into a structured operations action',
          description:
            'Accepts English, French, Persian or Finglish. Returns a parsed ' +
            'preview first; resend with confirm true to apply. Never invents values.',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['message'],
            properties: {
              source: { type: 'string', enum: ['chatgpt', 'claude', 'webapp', 'webhook'] },
              user: { type: 'string' },
              message: { type: 'string' },
              requestedAction: { type: 'string' },
              idempotencyKey: { type: 'string' },
              confirm: { type: 'boolean' },
              autoCommit: { type: 'boolean' },
            } } } } },
          responses: {
            200: { description: 'Preview, or the committed result' },
            409: { description: 'Blocked — missing or ambiguous information' },
          },
        },
      },
    },
  };
}
