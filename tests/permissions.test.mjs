/**
 * Role and capability tests.
 *
 * The capability table decides whether a request is answered or refused with
 * 403, so every route's guard is asserted here against the role it will see.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ROLES, CAPABILITIES, can, roleForEmail } from '../.test-build/core.js';

/** What each route guard actually requires. */
const ROUTE_GUARDS = [
  ['GET  /api/jobs', 'read'],
  ['POST /api/jobs', 'write'],
  ['GET  /api/jobs/{id}', 'read'],
  ['PATCH /api/jobs/{id}', 'write'],
  ['GET  /api/reminders', 'read'],
  ['POST /api/reminders', 'write'],
  ['GET  /api/materials', 'read'],
  ['GET  /api/logs', 'read'],
  ['POST /api/logs', 'log'],
  ['GET  /api/team', 'read'],
  ['GET  /api/dashboard', 'read'],
  ['GET  /api/completed', 'read'],
  ['GET  /api/audit', 'audit'],
  ['POST /api/audit (undo)', 'undo'],
  ['POST /api/ai/intake', 'ai'],
];

const allowed = (role) => ROUTE_GUARDS.filter(([, cap]) => can(role, cap)).map(([r]) => r);

describe('role model', () => {
  test('exactly four roles exist', () => {
    assert.deepEqual([...ROLES], ['admin', 'coordinator', 'technician', 'readonly']);
  });

  test('every role has at least read', () => {
    for (const role of ROLES) assert.equal(can(role, 'read'), true, role);
  });

  test('an unknown capability is refused for everyone', () => {
    for (const role of ROLES) assert.equal(can(role, 'launch-missiles'), false, role);
  });
});

describe('administrator', () => {
  test('can do everything the routes ask for', () => {
    for (const [route, cap] of ROUTE_GUARDS) {
      assert.equal(can('admin', cap), true, `admin should reach ${route}`);
    }
  });

  test('is the only role that may undo', () => {
    assert.equal(can('admin', 'undo'), true);
    assert.equal(can('coordinator', 'undo'), false);
    assert.equal(can('technician', 'undo'), false);
    assert.equal(can('readonly', 'undo'), false);
  });

  test('is the only role that may change settings', () => {
    assert.deepEqual(ROLES.filter((r) => can(r, 'settings')), ['admin']);
  });
});

describe('coordinator', () => {
  test('can run the day: read, write, complete, log, audit and the AI inbox', () => {
    for (const cap of ['read', 'write', 'complete', 'log', 'audit', 'ai']) {
      assert.equal(can('coordinator', cap), true, cap);
    }
  });

  test('can file a daily log — this is the bearer/MCP path', () => {
    // ChatGPT and the Claude MCP server authenticate as coordinator, and
    // POST /api/logs is guarded on `log`. Without it, add_daily_log 403s.
    assert.equal(can('coordinator', 'log'), true);
  });

  test('cannot undo or change settings', () => {
    assert.equal(can('coordinator', 'undo'), false);
    assert.equal(can('coordinator', 'settings'), false);
  });

  test('reaches every route except undo and settings', () => {
    const reachable = allowed('coordinator');
    assert.ok(reachable.includes('POST /api/logs'));
    assert.ok(reachable.includes('POST /api/ai/intake'));
    assert.ok(!reachable.includes('POST /api/audit (undo)'));
  });
});

describe('technician', () => {
  test('can read, file daily logs and complete work', () => {
    assert.equal(can('technician', 'read'), true);
    assert.equal(can('technician', 'log'), true);
    assert.equal(can('technician', 'complete'), true);
  });

  test('cannot create or re-scope jobs', () => {
    assert.equal(can('technician', 'write'), false);
  });

  test('cannot reach settings, the audit trail, undo or the AI inbox', () => {
    for (const cap of ['settings', 'audit', 'undo', 'ai']) {
      assert.equal(can('technician', cap), false, cap);
    }
  });

  test('reaches exactly the field-worker routes', () => {
    const reachable = allowed('technician');
    assert.ok(reachable.includes('POST /api/logs'), 'may submit a daily report');
    assert.ok(reachable.includes('GET  /api/jobs'), 'may see assigned work');
    assert.ok(!reachable.includes('POST /api/jobs'), 'may not create jobs');
    assert.ok(!reachable.includes('GET  /api/audit'));
  });
});

describe('read only', () => {
  test('can read and nothing else', () => {
    assert.deepEqual(CAPABILITIES.readonly, ['read']);
  });

  test('every write route is refused', () => {
    for (const cap of ['write', 'complete', 'log', 'settings', 'audit', 'undo', 'ai']) {
      assert.equal(can('readonly', cap), false, cap);
    }
  });
});

describe('allowlist', () => {
  const env = {
    ALLOWLIST_ADMIN: 'boss@totalrenotech.ca',
    ALLOWLIST_COORDINATOR: 'office@totalrenotech.ca, second@totalrenotech.ca',
    ALLOWLIST_TECHNICIAN: 'meisam@totalrenotech.ca',
    ALLOWLIST_READONLY: 'viewer@totalrenotech.ca',
  };

  test('maps each list to its role', () => {
    assert.equal(roleForEmail('boss@totalrenotech.ca', env), 'admin');
    assert.equal(roleForEmail('office@totalrenotech.ca', env), 'coordinator');
    assert.equal(roleForEmail('second@totalrenotech.ca', env), 'coordinator');
    assert.equal(roleForEmail('meisam@totalrenotech.ca', env), 'technician');
    assert.equal(roleForEmail('viewer@totalrenotech.ca', env), 'readonly');
  });

  test('is case and whitespace insensitive', () => {
    assert.equal(roleForEmail('  BOSS@TotalRenoTech.ca ', env), 'admin');
  });

  test('an unlisted address gets no role at all', () => {
    assert.equal(roleForEmail('stranger@example.com', env), null);
    assert.equal(roleForEmail('', env), null);
    assert.equal(roleForEmail(null, env), null);
  });

  test('the highest-privilege list wins when an address appears twice', () => {
    const dual = {
      ALLOWLIST_ADMIN: 'both@trt.ca',
      ALLOWLIST_READONLY: 'both@trt.ca',
    };
    assert.equal(roleForEmail('both@trt.ca', dual), 'admin');
  });

  test('an empty environment locks everyone out', () => {
    assert.equal(roleForEmail('boss@totalrenotech.ca', {}), null);
  });
});
