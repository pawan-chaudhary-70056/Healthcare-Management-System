/**
 * Live end-to-end smoke (PH-09 prep): drives the REAL stack — login per role
 * via HTTP cookie sessions, then verifies each role's dashboard API contract
 * (200s on own endpoints, 403 on foreign ones), plus a full booking flow
 * through the Vite dev proxy exactly as the browser would.
 *
 * Usage: node scripts/verify-live.mjs [base] [proxyBase]
 *   base   default http://127.0.0.1:4000/api/v1
 *   proxy  default http://127.0.0.1:5173/api/v1
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:4000/api/v1';
const PROXY = process.argv[3] ?? 'http://127.0.0.1:5173/api/v1';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Minimal cookie-jar fetch. */
function makeClient() {
  let cookie = '';
  return async function req(method, url, body, headers = {}) {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const [pair] = c.split(';');
      if (pair) cookie = pair; // single session per client — last wins is fine
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* no body */
    }
    return { status: res.status, body: json };
  };
}

const USERS = {
  admin: ['admin@hms.local', 'Admin@12345'],
  reception: ['reception@hms.local', 'Recept@12345'],
  doctor: ['doctor@hms.local', 'Doctor@12345'],
  nurse: ['nurse@hms.local', 'Nurse@12345'],
  labtech: ['labtech@hms.local', 'Tech@12345'],
  pharmacy: ['pharmacy@hms.local', 'Pharm@12345'],
  billing: ['billing@hms.local', 'Acct@12345'],
  patient: ['patient@hms.local', 'Patient@12345'],
};

async function login(role) {
  const [email, password] = USERS[role];
  const req = makeClient();
  const res = await req('POST', `${BASE}/auth/login`, { email, password });
  if (res.status === 429) {
    throw new Error(`login ${role}: 429 RATE_LIMITED — the strict /auth limiter tripped from repeated runs; restart the backend to reset it`);
  }
  if (res.status !== 200) throw new Error(`login ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  const me = await req('GET', `${BASE}/auth/me`);
  return { req, role, permissions: me.body?.data?.permissions ?? [], id: me.body?.data?.id };
}

async function main() {
  console.log(`Live smoke against ${BASE} (proxy: ${PROXY})\n`);

  // ---- Health (direct + through the vite proxy) ----
  const health = await fetch('http://127.0.0.1:4000/health').then((r) => r.json());
  check('health direct', health?.status === 'ok');
  const proxyBase = PROXY.replace('/api/v1', '');
  const proxyHealth = await fetch(`${proxyBase}/api/health`).then((r) => r.json()).catch(() => null);
  // The proxy only forwards /api/* → backend /api/*; the backend serves /health
  // at the root, so the proxied probe lands on 404. Presence of ANY JSON
  // envelope proves the proxy → backend round-trip works.
  check('proxy round-trip reachable', proxyHealth !== null);

  // ---- Login every role ----
  const sessions = {};
  for (const role of Object.keys(USERS)) {
    try {
      sessions[role] = await login(role);
      check(`login ${role}`, true);
    } catch (e) {
      check(`login ${role}`, false, String(e.message).slice(0, 120));
    }
  }

  // ---- Role → dashboard endpoint contracts (200 own / 403 foreign) ----
  const checks = [
    // [role, method, path, expected]
    ['admin', 'GET', '/appointments', 200],
    ['admin', 'GET', '/platform/audit', 200],
    ['admin', 'GET', '/platform/settings/policy', 200],
    ['reception', 'GET', '/appointments', 200],
    ['reception', 'GET', '/appointments/queue', 200],
    ['reception', 'GET', '/patients', 200],
    ['doctor', 'GET', '/appointments', 200],
    ['doctor', 'GET', '/clinical/encounters/open', 200],
    ['doctor', 'GET', '/clinical/prescriptions', 200],
    ['doctor', 'GET', '/platform/audit', 200], // own-events scope (PERM-64)
    // Nurse nursing-entry list is object-scoped; resolved against the demo
    // patient's real id below (care team membership) — placeholder check here.
    ['nurse', 'GET', '/appointments', 200],
    ['labtech', 'GET', '/lab/orders', 200],
    ['pharmacy', 'GET', '/pharmacy/queue', 200],
    ['pharmacy', 'GET', '/pharmacy/inventory/batches', 200],
    ['billing', 'GET', '/billing/invoices', 200],
    ['billing', 'GET', '/billing/reconciliation', 200],
    ['patient', 'GET', '/appointments/mine', 200],
    ['patient', 'GET', '/lab/orders', 200],
    ['patient', 'GET', '/clinical/prescriptions', 200],
    ['patient', 'GET', '/billing/invoices', 200],
    ['patient', 'GET', '/platform/notifications', 200],
    // Foreign-permission denials (403, permission middleware)
    ['patient', 'GET', '/platform/audit', 403],
    ['patient', 'POST', '/clinical/encounters', 403],
    ['patient', 'GET', '/pharmacy/queue', 403],
    ['doctor', 'GET', '/pharmacy/queue', 403],
    ['reception', 'GET', '/platform/settings/policy', 403],
    ['labtech', 'GET', '/billing/reconciliation', 403],
  ];
  for (const [role, method, path, expected] of checks) {
    const s = sessions[role];
    if (!s) {
      check(`${role} ${method} ${path}`, false, 'no session');
      continue;
    }
    const r = await s.req(method, `${BASE}${path}`, method === 'POST' ? {} : undefined);
    check(`${role} ${method} ${path} → ${expected}`, r.status === expected, `got ${r.status}`);
  }

  // ---- Full booking flow through the vite proxy (as the browser does) ----
  const admin = sessions.admin;
  const reception = sessions.reception;
  const proxied = makeClient();

  const doctors = await proxied('GET', `${PROXY}/public/doctors`);
  check('proxy: public doctors', doctors.status === 200 && doctors.body.data.length > 0);
  const doctorEntry = doctors.body.data[0];

  const depts = await proxied('GET', `${PROXY}/public/departments`);
  check('proxy: public departments', depts.status === 200 && depts.body.data.length > 0);
  const deptEntry = depts.body.data[0];

  // Target the DEMO doctor (has the seeded schedule) via the admin list.
  const doctorsAdmin = await admin.req('GET', `${BASE}/admin/doctors`);
  const demoDoctor = (doctorsAdmin.body?.data ?? []).find(
    (d) => d.fullName === 'Dr. Ada Sharma' || d.email === 'doctor@hms.local'
  ) ?? doctorsAdmin.body?.data?.[0];
  const doctorId = demoDoctor?.id ?? demoDoctor?._id;
  check('admin: doctors list for booking', Boolean(doctorId));

  // Nurse nursing-entries object check against the demo patient (care team).
  const patientsSearch = await sessions.reception.req('GET', `${BASE}/patients?q=Demo`);
  const demoPatientId = patientsSearch.body?.data?.[0]?._id ?? patientsSearch.body?.data?.[0]?.id;
  check('reception: patient search (booking lookup)', Boolean(demoPatientId));
  const nurseList = await sessions.nurse.req('GET', `${BASE}/clinical/nursing-entries?patientId=${demoPatientId}`);
  check('nurse: nursing entries for assigned patient → 200', nurseList.status === 200, `got ${nurseList.status}`);

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  // Slots are an authenticated endpoint (the browser always calls it logged-in;
  // the public patient picker passes the doctor id from the directory). The
  // patient's session cookie flows through the vite proxy unchanged.
  // Patient self-books through the proxy.
  const patient = sessions.patient;
  // Slots are an authenticated endpoint (the browser always calls it logged-in;
  // the public patient picker passes the doctor id from the directory). The
  // patient's session cookie flows through the vite proxy unchanged.
  const slots = await patient.req('GET', `${PROXY}/appointments/slots?doctorId=${doctorId}&date=${dateStr}`);
  check('proxy: slots computed (authenticated)', slots.status === 200 && slots.body.data.length > 0, `got ${slots.body.data?.length ?? 0}`);
  const slot = slots.body.data?.[0];
  if (!slot) {
    check('proxy: booking flow', false, 'no slots available — aborting flow');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  // Department must match the demo doctor's own department (the schedule is
  // registered against General Medicine) — take it from the admin view.
  const deptForBooking =
    demoDoctor?.departmentId ??
    (await admin.req('GET', `${BASE}/admin/departments`)).body?.data?.find?.((d) => d.name === demoDoctor?.department)?._id ??
    (deptEntry.id ?? deptEntry._id);
  const book = await patient.req('POST', `${PROXY}/appointments`, {
    doctorId,
    departmentId: deptForBooking,
    slotStartIso: slot.start,
    slotEndIso: slot.end,
  }, { 'Idempotency-Key': 'live-smoke-book-1' });
  check('proxy: patient books (201 REQUESTED)', book.status === 201 && book.body.data?.status === 'REQUESTED', `got ${book.status}`);

  const apptId = book.body.data?.id;
  if (apptId) {
    const confirm = await reception.req('POST', `${PROXY}/appointments/${apptId}/confirm`, {});
    check('proxy: reception confirms', confirm.status === 200 && confirm.body.data?.status === 'CONFIRMED');
    const checkin = await reception.req('POST', `${PROXY}/appointments/${apptId}/checkin`, {});
    check('proxy: reception check-in + token', checkin.status === 200 && checkin.body.data?.queueToken?.tokenNo >= 1);
    const enc = await sessions.doctor.req('POST', `${PROXY}/clinical/encounters`, { appointmentId: apptId });
    check('proxy: doctor starts encounter (IN_CONSULTATION)', enc.status === 201);
    if (enc.status === 201) {
      const emr = await sessions.doctor.req('POST', `${PROXY}/clinical/encounters/${enc.body.data.id}/emr`, {
        symptoms: 'Live smoke symptoms',
        diagnosis: 'Live smoke diagnosis',
      });
      check('proxy: doctor writes EMR', emr.status === 201);
      const rx = await sessions.doctor.req('POST', `${PROXY}/clinical/prescriptions`, {
        encounterId: enc.body.data.id,
        items: [{ medicine: 'Paracetamol 500mg', dose: '500mg', frequency: 'TDS', durationDays: 5, quantity: 9 }],
      });
      check('proxy: doctor prescribes', rx.status === 201);
      const fin = await sessions.doctor.req('POST', `${PROXY}/clinical/encounters/${enc.body.data.id}/finalize`, {});
      check('proxy: encounter finalize → COMPLETED', fin.status === 200 && fin.body.data?.appointmentStatus === 'COMPLETED');

      // Pharmacy: receive stock + dispense through the proxy.
      const recv = await sessions.pharmacy.req('POST', `${PROXY}/pharmacy/inventory/receive`, {
        drugCode: 'PARA500', batchNo: `LIVE-${Date.now()}`, expiryDate: '2027-12-31', quantity: 500,
      });
      check('proxy: pharmacy receives stock', recv.status === 201);
      if (rx.status === 201) {
        const dispense = await sessions.pharmacy.req('POST', `${PROXY}/pharmacy/dispense/${rx.body.data.id}`, {});
        check('proxy: pharmacy dispenses (FEFO)', dispense.status === 200 && dispense.body.data?.status === 'FULLY_DISPENSED');
      }

      // Billing: invoice + pay through the proxy.
      const inv = await sessions.billing.req('POST', `${PROXY}/billing/invoices`, { patientId: book.body.data.patientId });
      check('proxy: billing drafts invoice', inv.status === 201);
      if (inv.status === 201) {
        const issued = await sessions.billing.req('POST', `${PROXY}/billing/invoices/${inv.body.data.id}/issue`, {});
        check('proxy: billing issues invoice', issued.status === 200);
        const pay = await sessions.billing.req('POST', `${PROXY}/billing/payments`, {
          invoiceId: inv.body.data.id, amountMinor: issued.body.data.totalMinor, method: 'CASH',
        });
        check('proxy: billing records payment → PAID', pay.status === 200 && pay.body.data?.invoice?.status === 'PAID');
      }
    }
  }

  // ---- Summary ----
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
