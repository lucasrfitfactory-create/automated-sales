import type {
  MarianaTekClient,
  MtClassSession,
  MtClient,
  MtMembershipStatus,
  MtRosterEntry,
} from './types.js';

// Deterministic-ish seeded data so `npm run assess` produces a realistic,
// varied recap in mock mode — one of every membership status kind, so the
// rules engine and recap formatting can be exercised end to end before the
// real Mariana Tek API key arrives.

const CLIENTS: MtClient[] = [
  { id: 'c1', firstName: 'Ava', lastName: 'Chen', email: 'ava.chen@example.com', phone: '4165550101' },
  { id: 'c2', firstName: 'Liam', lastName: 'Brooks', email: 'liam.brooks@example.com', phone: '4165550102' },
  { id: 'c3', firstName: 'Sofia', lastName: 'Reyes', email: 'sofia.reyes@example.com', phone: '4165550103' },
  { id: 'c4', firstName: 'Noah', lastName: 'Patel', email: 'noah.patel@example.com', phone: '4165550104' },
  { id: 'c5', firstName: 'Mia', lastName: 'Tremblay', email: 'mia.tremblay@example.com', phone: '4165550105' },
  { id: 'c6', firstName: 'Ethan', lastName: 'Wong', email: 'ethan.wong@example.com', phone: null },
  { id: 'c7', firstName: 'Zara', lastName: 'Khan', email: 'zara.khan@example.com', phone: '4165550107' },
  { id: 'c8', firstName: 'Jack', lastName: 'Sullivan', email: 'jack.sullivan@example.com', phone: '4165550108' },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

const MEMBERSHIP_STATUS: Record<string, MtMembershipStatus> = {
  c1: { kind: 'intro_offer', offerName: 'Intro Week Unlimited', startDate: daysAgo(1), endDate: daysFromNow(6), classesUsed: 1, classesIncluded: 999 },
  c2: { kind: 'intro_offer', offerName: '3-Class Intro Pack', startDate: daysAgo(6), endDate: daysFromNow(1), classesUsed: 3, classesIncluded: 3 },
  c3: { kind: 'class_pack', packName: '10-Class Pack', classesRemaining: 1, classesTotal: 10, expiresAt: daysFromNow(20) },
  c4: { kind: 'class_pack', packName: '5-Class Pack', classesRemaining: 0, classesTotal: 5, expiresAt: daysAgo(2) },
  c5: { kind: 'membership_active', planName: 'Unlimited Monthly', memberSince: daysAgo(190) },
  c6: { kind: 'membership_paused', planName: 'Unlimited Monthly', resumesAt: daysFromNow(10) },
  c7: { kind: 'membership_lapsed', planName: 'Unlimited Monthly', endedAt: daysAgo(45) },
  c8: { kind: 'no_active_status' },
};

const CLASS_SESSIONS: MtClassSession[] = [
  { id: 'cls1', className: 'Sculpt 45', instructor: 'Jordan P.', startTime: daysAgo(1), locationId: '48718' },
  { id: 'cls2', className: 'Power Cycle', instructor: 'Riley T.', startTime: daysAgo(2), locationId: '48718' },
];

const ROSTERS: Record<string, MtRosterEntry[]> = {
  cls1: [
    { classSessionId: 'cls1', clientId: 'c1', attended: true },
    { classSessionId: 'cls1', clientId: 'c2', attended: true },
    { classSessionId: 'cls1', clientId: 'c3', attended: true },
    { classSessionId: 'cls1', clientId: 'c5', attended: true },
  ],
  cls2: [
    { classSessionId: 'cls2', clientId: 'c4', attended: true },
    { classSessionId: 'cls2', clientId: 'c6', attended: true },
    { classSessionId: 'cls2', clientId: 'c7', attended: true },
    { classSessionId: 'cls2', clientId: 'c8', attended: true },
  ],
};

export function createMockMarianaTekClient(): MarianaTekClient {
  return {
    async getClassSessions({ since, before }) {
      const sinceMs = new Date(since).getTime();
      const beforeMs = new Date(before).getTime();
      return CLASS_SESSIONS.filter((c) => {
        const t = new Date(c.startTime).getTime();
        return t >= sinceMs && t < beforeMs;
      });
    },
    async getRoster(classSessionId) {
      return ROSTERS[classSessionId] ?? [];
    },
    async getClient(clientId) {
      const client = CLIENTS.find((c) => c.id === clientId);
      if (!client) throw new Error(`mock client not found: ${clientId}`);
      return client;
    },
    async getMembershipStatus(clientId) {
      const status = MEMBERSHIP_STATUS[clientId];
      if (!status) throw new Error(`mock membership status not found: ${clientId}`);
      return status;
    },
  };
}
