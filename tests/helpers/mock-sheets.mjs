/**
 * A mock Google Sheets v4 client backed by an in-memory grid.
 *
 * It reproduces the live workbook's real shape: the exact header text, the
 * header row of each table (All Jobs on row 5, Team on row 6, Fleet on row 50)
 * and the ARRAYFORMULA that ARCHIVE derives from ACTIVE REMINDERS.
 *
 * The repositories under test talk to this exactly as they talk to Google, so
 * a write that would corrupt the sheet fails here too.
 */

/* ------------------------------------------------------------------ *
 * Live header rows
 * ------------------------------------------------------------------ */

export const ALL_JOBS_HEADERS = [
  'Job ID', 'Client / Store', 'Project Type', 'Full Address', 'City', 'Unit',
  'Contact Name', 'Phone', 'Email', 'WO #', 'PO #', 'Scope of Work',
  'Priority', 'Status', 'Scheduled Date', 'Arrival Window', 'Actual Start',
  'Actual End', 'Truck', 'Technician 1', 'Technician 2', 'Technician 3',
  'Technician 4', 'Technician 5', 'Team Summary', 'Crew Count',
  'Hours / Person', 'Total Labor Hours', 'Materials', 'Material Status',
  'Long Project?', 'Project Start', 'Project End', 'Latest Work Report',
  'Photos / Docs Link', 'Client Signature', 'National Check-in/out',
  'Invoice Status', 'Payment Status', 'Follow-up Date', 'Reminder Type',
  'Notes', 'Last Updated', 'Created By',
];

export const REMINDER_HEADERS = [
  'ID', 'Date Added', 'Category', 'Customer/Project', 'Required Action',
  'Assigned To', 'Priority', 'Status', 'Due Date & Time', 'Next Follow-Up',
  'Contact & Address', 'Related File/Reference', 'Payment/Amount',
  'Waiting For/Latest Response', 'Notes/Links', 'Last Updated',
];

export const TEAM_HEADERS = [
  'Employee ID', 'Full Name', 'Display Name', 'Role', 'Department', 'Phone',
  'Email', 'Employment Status', 'Default Truck', 'Driver Status', 'Supervisor',
  'Start Date', 'Certifications', 'Emergency Contact', 'Notes', 'Last Updated',
];

export const FLEET_HEADERS = [
  'Truck ID', 'Truck Number', 'Vehicle Description', 'Licence Plate',
  'Primary Driver', 'Backup Driver', 'Operational Status', 'Current Project',
  'Storage Location', 'Last Service', 'Next Maintenance',
  'Registration Renewal', 'Insurance Renewal', 'Odometer', 'Equipment Notes',
  'Notes', 'Last Updated',
];

export const LOG_HEADERS = [
  'Log ID', 'Work Date', 'Job ID', 'Client / Project', 'Location', 'Truck',
  'Technician 1', 'Technician 2', 'Technician 3', 'Technician 4', 'Technician 5',
  'Team Summary', 'Crew Count', 'Clock In', 'Clock Out', 'Break (min)',
  'Hours / Person', 'Total Labor Hours', 'Work Completed', 'Materials Used',
  'Issues / Delays', 'Photos / Docs', 'Next Step', 'Daily Status',
  'Supervisor', 'Verified?', 'Notes',
];

/** The array formula that produces ARCHIVE from ACTIVE REMINDERS. */
export const ARCHIVE_A6_FORMULA =
  '=ARRAYFORMULA(IFERROR(QUERY(\'ACTIVE REMINDERS\'!A6:P205,' +
  '"select * where Col8 matches \'Completed|Cancelled|Removed\'",0),""))';

/* ------------------------------------------------------------------ *
 * A1 parsing
 * ------------------------------------------------------------------ */

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Parse "'All Jobs'!A6:AR155", "'X'!D7" or "'X'!5:5". */
export function parseRange(a1) {
  const bang = a1.lastIndexOf('!');
  let sheet = a1.slice(0, bang);
  const ref = a1.slice(bang + 1);
  if (sheet.startsWith("'") && sheet.endsWith("'")) {
    sheet = sheet.slice(1, -1).replace(/''/g, "'");
  }

  const [fromRef, toRef = fromRef] = ref.split(':');
  const parse = (r) => {
    const m = /^([A-Za-z]*)(\d*)$/.exec(r) ?? [];
    return { col: m[1] ? colToIndex(m[1]) : null, row: m[2] ? Number(m[2]) : null };
  };
  const a = parse(fromRef);
  const b = parse(toRef);
  return {
    sheet,
    startRow: a.row ?? 1,
    endRow: b.row ?? null,
    startCol: a.col ?? 1,
    endCol: b.col ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * The grid
 * ------------------------------------------------------------------ */

export class MockWorkbook {
  constructor() {
    /** sheet title -> Map<`r,c`, value> */
    this.cells = new Map();
    this.meta = new Map();          // title -> sheetId
    this.writes = [];               // every range that was written
    this.nextSheetId = 1000;
    /** sheet title -> () => row arrays, for formula-driven views */
    this.derivers = new Map();
  }

  /**
   * Mark a sheet as formula-driven.
   *
   * Google returns the *computed* values for such a sheet, not the formula
   * text, so the mock does the same — otherwise a test would read the raw
   * "=ARRAYFORMULA(...)" string and prove nothing.
   */
  derive(title, fn) {
    this.derivers.set(title, fn);
    return this;
  }

  addSheet(title, sheetId) {
    if (!this.cells.has(title)) this.cells.set(title, new Map());
    this.meta.set(title, sheetId ?? this.nextSheetId++);
    return this;
  }

  set(title, row, col, value) {
    if (!this.cells.has(title)) this.addSheet(title);
    this.cells.get(title).set(`${row},${col}`, value);
    return this;
  }

  get(title, row, col) {
    return this.cells.get(title)?.get(`${row},${col}`) ?? '';
  }

  /** Write a whole row starting at column 1. */
  setRow(title, row, values) {
    values.forEach((v, i) => this.set(title, row, i + 1, v));
    return this;
  }

  /**
   * The raw stored cell, bypassing any deriver.
   *
   * Reading ARCHIVE through the API returns computed values; this returns what
   * is actually parked in the cell, which is how a test can prove the array
   * formula in A6 was never overwritten.
   */
  getFormula(title, row, col) {
    return this.get(title, row, col);
  }

  /** Every write this workbook received that targeted the named sheet. */
  writesTo(title) {
    return this.writes.filter((range) => parseRange(range).sheet === title);
  }

  /** How many data rows a table currently holds. */
  rowCount(title, firstDataRow = 6) {
    return this.rowsOf(title).filter((r) => r >= firstDataRow).length;
  }

  /** Every populated row index on a sheet, ascending. */
  rowsOf(title) {
    const rows = new Set();
    for (const key of this.cells.get(title)?.keys() ?? []) {
      rows.add(Number(key.split(',')[0]));
    }
    return [...rows].sort((a, b) => a - b);
  }

  /** googleapis-shaped client. */
  client() {
    const wb = this;
    return {
      spreadsheets: {
        get: async () => ({
          data: {
            sheets: [...wb.meta.entries()].map(([title, sheetId]) => ({
              properties: { title, sheetId },
            })),
          },
        }),

        batchUpdate: async ({ requestBody }) => {
          for (const req of requestBody.requests ?? []) {
            if (req.addSheet) wb.addSheet(req.addSheet.properties.title);
          }
          return { data: {} };
        },

        values: {
          get: async ({ range }) => {
            const r = parseRange(range);
            const sheet = wb.cells.get(r.sheet);
            if (!sheet) {
              const err = new Error(`Unable to parse range: ${range}`);
              err.code = 400;
              throw err;
            }
            const lastRow = r.endRow ?? Math.max(0, ...wb.rowsOf(r.sheet));
            const lastCol = r.endCol ?? 60;

            // A formula-driven sheet returns computed values from row 6 down.
            const deriver = wb.derivers.get(r.sheet);
            const derived = deriver ? deriver(wb) : null;

            const values = [];
            for (let row = r.startRow; row <= lastRow; row++) {
              const line = [];
              for (let col = r.startCol; col <= lastCol; col++) {
                if (derived && row >= 6) {
                  const dr = derived[row - 6];
                  line.push(dr ? (dr[col - 1] ?? '') : '');
                } else {
                  line.push(wb.get(r.sheet, row, col));
                }
              }
              // Trim trailing blanks the way the API does.
              while (line.length && (line.at(-1) === '' || line.at(-1) === undefined)) line.pop();
              values.push(line);
            }
            while (values.length && values.at(-1).length === 0) values.pop();
            return { data: { values } };
          },

          batchUpdate: async ({ requestBody }) => {
            for (const item of requestBody.data ?? []) {
              const r = parseRange(item.range);
              wb.writes.push(item.range);
              item.values.forEach((line, dr) => {
                line.forEach((v, dc) => {
                  wb.set(r.sheet, r.startRow + dr, r.startCol + dc, v);
                });
              });
            }
            return { data: {} };
          },

          update: async ({ range, requestBody }) => {
            const r = parseRange(range);
            wb.writes.push(range);
            (requestBody.values ?? []).forEach((line, dr) => {
              line.forEach((v, dc) => {
                wb.set(r.sheet, r.startRow + dr, r.startCol + dc, v);
              });
            });
            return { data: {} };
          },
        },
      },
    };
  }
}

/* ------------------------------------------------------------------ *
 * A workbook shaped like the live one
 * ------------------------------------------------------------------ */

/** Build the job row for NP-96651, the record used to prove address handling. */
function jobRow(over = {}) {
  const row = new Array(ALL_JOBS_HEADERS.length).fill('');
  const put = (header, value) => {
    row[ALL_JOBS_HEADERS.indexOf(header)] = value;
  };
  put('Job ID', over.jobId ?? '');
  put('Client / Store', over.customer ?? '');
  put('Project Type', over.projectType ?? 'NATIONAL PROJECT');
  put('Full Address', over.fullAddress ?? '');
  put('City', over.city ?? '');
  put('Unit', over.unit ?? '');
  put('WO #', over.wo ?? '');
  put('PO #', over.po ?? '');
  put('Priority', over.priority ?? 'HIGH');
  put('Status', over.status ?? 'NEED SCHEDULING');
  put('Scheduled Date', over.scheduledDate ?? '');
  put('Project End', over.projectEnd ?? '');
  put('Materials', over.materials ?? '');
  put('Material Status', over.materialStatus ?? '');
  put('Long Project?', over.longProject ?? '');
  put('Technician 1', over.tech1 ?? '');
  put('Last Updated', over.lastUpdated ?? '');
  return row;
}

/**
 * A workbook that mirrors the live one closely enough to test against:
 * eight completed jobs in August plus the live NP-96651 record.
 */
export function buildLiveLikeWorkbook() {
  const wb = new MockWorkbook();

  wb.addSheet('All Jobs', 1461297065);
  wb.addSheet('ACTIVE REMINDERS', 1016331232);
  wb.addSheet('ARCHIVE', 1016331233);
  wb.addSheet('Daily Logs', 58230643);
  wb.addSheet('Team & Fleet', 1500000001);
  wb.addSheet('Upcoming', 47021056);
  // The completed-history tab: visible title "No Name", addressed by sheet id.
  wb.addSheet('No Name', 2026082401);
  wb.setRow('No Name', 5, ['Job ID', 'Client / Store', 'Status', 'Project End', 'Notes']);

  /* ---- All Jobs ---- */
  wb.setRow('All Jobs', 5, ALL_JOBS_HEADERS);
  wb.setRow('All Jobs', 6, jobRow({
    jobId: 'NP-96651', customer: 'WINNERS #451 – GRIFFINTOWN',
    fullAddress: '225 Rue Peel, Montreal, QC', city: 'Montreal, QC',
    wo: '96651', po: '361032212', status: 'NEED INFO',
  }));

  // Eight completed jobs, all with Project End inside August 2026.
  for (let i = 0; i < 8; i++) {
    wb.setRow('All Jobs', 7 + i, jobRow({
      jobId: `NP-9700${i}`,
      customer: `COMPLETED CLIENT ${i + 1}`,
      fullAddress: `${100 + i} Rue Test, Montreal, QC`,
      city: 'Montreal, QC',
      wo: `9700${i}`,
      status: i % 2 === 0 ? 'COMPLETED' : 'DONE',
      // Deliberately booked in July to prove Scheduled Date is not used.
      scheduledDate: '2026-07-15',
      projectEnd: `2026-08-${String(4 + i).padStart(2, '0')}`,
    }));
  }

  /* ---- ACTIVE REMINDERS ---- */
  wb.setRow('ACTIVE REMINDERS', 5, REMINDER_HEADERS);
  wb.setRow('ACTIVE REMINDERS', 6, [
    'REM-0001', '2026-08-20', 'Estimate', 'MARSHALLS MEGA #777',
    'Follow up on estimate', 'Hamed', 'High', 'Follow-Up Required',
    '2026-08-26', '', '', '', '1500', '', '', '2026-08-20 09:00',
  ]);

  /* ---- ARCHIVE: a formula view over ACTIVE REMINDERS ---- */
  wb.setRow('ARCHIVE', 5, REMINDER_HEADERS);
  wb.set('ARCHIVE', 6, 1, ARCHIVE_A6_FORMULA);
  wb.derive('ARCHIVE', (book) => {
    const out = [];
    for (const row of book.rowsOf('ACTIVE REMINDERS')) {
      if (row < 6) continue;
      const status = String(book.get('ACTIVE REMINDERS', row, 8) ?? '');
      if (!/^(Completed|Cancelled|Removed)$/i.test(status.trim())) continue;
      out.push(REMINDER_HEADERS.map((_h, i) => book.get('ACTIVE REMINDERS', row, i + 1)));
    }
    return out;
  });

  /* ---- audit log ---- */
  wb.addSheet('_TRT_AUDIT_LOG');
  wb.setRow('_TRT_AUDIT_LOG', 5, [
    'Audit ID', 'Timestamp', 'User', 'Source', 'Action', 'Sheet', 'Row',
    'Field', 'Previous Value', 'New Value', 'Result', 'Error',
    'Idempotency Key', 'Undone',
  ]);

  /* ---- Daily Logs ---- */
  wb.setRow('Daily Logs', 5, LOG_HEADERS);

  /* ---- Team & Fleet: two tables, two header rows ---- */
  wb.setRow('Team & Fleet', 5, ['TABLE 1 — TEAM MEMBERS']);
  wb.setRow('Team & Fleet', 6, TEAM_HEADERS);
  const people = [
    'Meisam', 'Pirooz', 'Arsalan', 'Farzad', 'Ali Agha', 'Alireza',
    'Arash', 'Agha Nemat', 'Mohammad', 'Ali 2 - Helper', 'Hamed', 'Ehsan',
  ];
  people.forEach((name, i) => {
    const row = new Array(TEAM_HEADERS.length).fill('');
    row[0] = `TRT-EMP-${String(i + 1).padStart(3, '0')}`;
    row[1] = name;
    row[2] = name;
    row[7] = 'ACTIVE';
    row[9] = i < 3 ? 'DRIVER' : 'TBD';
    wb.setRow('Team & Fleet', 7 + i, row);
  });

  wb.setRow('Team & Fleet', 49, ['TABLE 2 — TRUCKS & FLEET']);
  wb.setRow('Team & Fleet', 50, FLEET_HEADERS);
  const trucks = [
    'TRUCK #1', 'TRUCK #3', 'TRUCK #4', 'TRUCK #5',
    'TRUCK #6', 'TRUCK #7', 'OFFICE / VISIT', 'TBD',
  ];
  trucks.forEach((label, i) => {
    const row = new Array(FLEET_HEADERS.length).fill('');
    row[0] = `TRT-TRK-${String(i + 1).padStart(2, '0')}`;
    row[1] = label;
    row[6] = i < 2 ? 'AVAILABLE' : 'TBD';
    wb.setRow('Team & Fleet', 51 + i, row);
  });

  /* ---- the untitled completed-history tab ---- */
  wb.setRow('', 5, ALL_JOBS_HEADERS);

  return wb;
}
