/**
 * QueueLess — Database Access Layer & State Engine
 * Integrated with MongoDB Atlas & Local JSON File Persistence Fallback.
 * Authoritative single source of truth for Virtual Queue, Appointments,
 * Offices, Counters, Users (RBAC), Sessions, and Audit Logs.
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const auth = require('./auth');

const DATA_DIR = path.join(__dirname, 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');
const OFFICES_FILE = path.join(DATA_DIR, 'offices.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');

// Default Baseline Queue State
const DEFAULT_STATE = {
  currentServing: {
    id: 'A-40',
    type: 'ONLINE',
    service: 'Income Certificate',
    office: 'Rajkot District Service Center',
    customerName: 'Priya Sharma',
    mobile: '9812345678',
    status: 'SERVING',
    counter: 'Counter 2',
    calledAt: new Date(Date.now() - 3 * 60000).toISOString()
  },
  tokens: [
    {
      id: 'A-41',
      type: 'ONLINE',
      service: 'Income Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Amit Verma',
      mobile: '9823456789',
      status: 'WAITING',
      createdAt: new Date(Date.now() - 15 * 60000).toISOString()
    },
    {
      id: 'A-42',
      type: 'WALK-IN',
      service: 'Residence Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Suresh Mehta',
      mobile: '9834567890',
      status: 'WAITING',
      createdAt: new Date(Date.now() - 10 * 60000).toISOString()
    },
    {
      id: 'A-43',
      type: 'ONLINE',
      service: 'Birth Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Neha Gupta',
      mobile: '9845678901',
      status: 'WAITING',
      createdAt: new Date(Date.now() - 5 * 60000).toISOString()
    }
  ],
  completedTokens: [
    { id: 'A-38', type: 'ONLINE', service: 'Income Certificate', office: 'Rajkot District Service Center', status: 'COMPLETED' },
    { id: 'A-39', type: 'WALK-IN', service: 'Caste Certificate', office: 'Rajkot District Service Center', status: 'COMPLETED' }
  ],
  nextTokenNum: 44,
  completedCount: 24,
  walkinCount: 1,
  soundEnabled: true
};

// Default Gujarat Jan Seva Kendra Offices & Counters
const DEFAULT_OFFICES = [
  {
    id: 'OFF-RAJKOT-01',
    name: 'Rajkot District Service Center',
    tagline: 'Jan Seva Kendra, Collector Office Compound',
    district: 'Rajkot',
    services: ['Income Certificate', 'Residence Certificate', 'Birth Certificate', 'Caste Certificate', 'Non-Creamy Layer'],
    counters: [
      { id: 'C-RJK-01', name: 'Counter 1', service: 'Revenue Services', officerId: 'USR-OFFICER-01', officerName: 'Prakash Varma' },
      { id: 'C-RJK-02', name: 'Counter 2', service: 'Certificates & Public Grievances', officerId: 'USR-OFFICER-01', officerName: 'Prakash Varma' },
      { id: 'C-RJK-03', name: 'Counter 3', service: 'General Inquiries', officerId: null, officerName: 'Standby' }
    ]
  },
  {
    id: 'OFF-AHMEDABAD-01',
    name: 'Ahmedabad Civic Center (East Zone)',
    tagline: 'AMC Jan Seva Kendra, Viratnagar Cross Road',
    district: 'Ahmedabad',
    services: ['Property Tax', 'Birth Certificate', 'Trade License', 'Income Certificate'],
    counters: [
      { id: 'C-AHM-01', name: 'Counter 1', service: 'Property & Civic Taxes', officerId: 'USR-OFFICER-02', officerName: 'Sneha Patel' },
      { id: 'C-AHM-02', name: 'Counter 2', service: 'Certificates & Verification', officerId: null, officerName: 'Standby' }
    ]
  },
  {
    id: 'OFF-SURAT-01',
    name: 'Surat Municipal Seva Kendra',
    tagline: 'Athwa Zone Civic Facility',
    district: 'Surat',
    services: ['Income Certificate', 'Domicile Certificate', 'Water Drainage Services'],
    counters: [
      { id: 'C-SRT-01', name: 'Counter 1', service: 'Citizen Services', officerId: null, officerName: 'Standby' }
    ]
  }
];

let mongoClient = null;
let mongoDb = null;
let isMongoConnected = false;
let dbStatusInfo = {
  mode: 'file_fallback',
  connected: false,
  dbName: null,
  message: 'MONGODB_URI not configured in .env; running in local file persistence fallback mode'
};

// ==========================================
// File Persistence Helpers
// ==========================================

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFile(filePath, defaultData) {
  ensureDataDir();
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.warn(`[STORAGE WARNING] Corrupted file ${path.basename(filePath)}, resetting.`);
    }
  }
  const initial = typeof defaultData === 'function' ? defaultData() : JSON.parse(JSON.stringify(defaultData));
  saveFile(filePath, initial);
  return initial;
}

function saveFile(filePath, data) {
  ensureDataDir();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[STORAGE ERROR] Failed writing ${path.basename(filePath)}: ${e.message}`);
  }
}

// In-Memory Cached File Tables
let fileState = loadFile(QUEUE_FILE, DEFAULT_STATE);
let fileAppointments = loadFile(APPOINTMENTS_FILE, []);
let fileOffices = loadFile(OFFICES_FILE, DEFAULT_OFFICES);
let fileUsers = loadFile(USERS_FILE, () => {
  const officerCred = auth.hashPassword('officer123');
  const pendingCred = auth.hashPassword('staff123');
  const adminCred = auth.hashPassword(process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234');
  return [
    {
      id: 'USR-ADMIN-01',
      username: process.env.ADMIN_USERNAME || 'admin',
      email: `${process.env.ADMIN_USERNAME || 'admin'}@queueless.gov.in`,
      name: 'System Administrator',
      mobile: '9999999999',
      role: 'admin',
      status: 'APPROVED',
      office: 'All Offices',
      counter: 'All Counters',
      passwordHash: adminCred.hash,
      salt: adminCred.salt,
      createdAt: new Date().toISOString(),
      approvedBy: 'System Auto-Provision',
      approvedAt: new Date().toISOString()
    },
    {
      id: 'USR-OFFICER-01',
      username: 'officer1',
      email: 'officer1@queueless.gov.in',
      name: 'Prakash Varma',
      mobile: '9876500001',
      role: 'officer',
      status: 'APPROVED',
      office: 'Rajkot District Service Center',
      counter: 'Counter 2',
      passwordHash: officerCred.hash,
      salt: officerCred.salt,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      approvedBy: 'System Auto-Seed',
      approvedAt: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'USR-OFFICER-02',
      username: 'sneha_patel',
      email: 'sneha.patel@queueless.gov.in',
      name: 'Sneha Patel',
      mobile: '9876500002',
      role: 'officer',
      status: 'PENDING',
      office: 'Ahmedabad Civic Center (East Zone)',
      counter: 'Counter 1',
      passwordHash: pendingCred.hash,
      salt: pendingCred.salt,
      createdAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null
    }
  ];
});
let fileSessions = loadFile(SESSIONS_FILE, {});
let fileActivityLogs = loadFile(ACTIVITY_FILE, () => [
  {
    id: 'LOG-001',
    timestamp: new Date().toISOString(),
    action: 'SYSTEM_STARTUP',
    actor: { name: 'System', role: 'system' },
    details: 'QueueLess civic-tech server initialized.'
  }
]);

// ==========================================
// Database Initialization
// ==========================================

async function initDatabase() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'queueless';

  if (!uri || !uri.trim()) {
    isMongoConnected = false;
    dbStatusInfo = {
      mode: 'file_fallback',
      connected: false,
      dbName: null,
      missingConfig: ['MONGODB_URI'],
      message: 'MONGODB_URI is not set in environment or .env. Running on local file persistence fallback.'
    };
    await provisionInitialAdminIfConfigured();
    return dbStatusInfo;
  }

  try {
    mongoClient = new MongoClient(uri, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000
    });

    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);

    // Ensure Indexes
    const tokensCol = mongoDb.collection('tokens');
    const appointmentsCol = mongoDb.collection('appointments');
    const officesCol = mongoDb.collection('offices');
    const usersCol = mongoDb.collection('users');
    const metadataCol = mongoDb.collection('metadata');

    await tokensCol.createIndex({ id: 1 }, { unique: true });
    await tokensCol.createIndex({ status: 1, office: 1, service: 1 });
    await appointmentsCol.createIndex({ id: 1 }, { unique: true });
    await usersCol.createIndex({ username: 1 }, { unique: true });
    await usersCol.createIndex({ email: 1 });

    const existingCount = await tokensCol.countDocuments();
    if (existingCount === 0) {
      const seedTokens = [
        DEFAULT_STATE.currentServing,
        ...DEFAULT_STATE.tokens,
        ...DEFAULT_STATE.completedTokens
      ];
      await tokensCol.insertMany(seedTokens);
      await metadataCol.updateOne(
        { _id: 'queue_meta' },
        {
          $set: {
            nextTokenNum: DEFAULT_STATE.nextTokenNum,
            completedCount: DEFAULT_STATE.completedCount,
            walkinCount: DEFAULT_STATE.walkinCount,
            soundEnabled: true
          }
        },
        { upsert: true }
      );
    }

    const existingOffices = await officesCol.countDocuments();
    if (existingOffices === 0) {
      await officesCol.insertMany(DEFAULT_OFFICES);
    }

    isMongoConnected = true;
    dbStatusInfo = {
      mode: 'mongodb',
      connected: true,
      dbName,
      message: `Successfully connected to MongoDB Atlas database "${dbName}".`
    };

    await provisionInitialAdminIfConfigured();
    return dbStatusInfo;
  } catch (err) {
    isMongoConnected = false;
    dbStatusInfo = {
      mode: 'file_fallback',
      connected: false,
      dbName: null,
      error: err.message,
      message: `Failed to connect to MongoDB Atlas (${err.message}). Falling back to file persistence.`
    };
    console.warn(`[MONGODB WARNING] ${dbStatusInfo.message}`);
    await provisionInitialAdminIfConfigured();
    return dbStatusInfo;
  }
}

function getDatabaseStatus() {
  return dbStatusInfo;
}

// ==========================================
// Admin Account Provisioning
// ==========================================

async function provisionInitialAdminIfConfigured() {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234';

  const existingAdmin = await getUserByRole('admin');
  if (existingAdmin) {
    return;
  }

  const cred = auth.hashPassword(adminPassword.trim());
  const adminUser = {
    id: 'USR-ADMIN-01',
    username: adminUsername,
    email: `${adminUsername}@queueless.gov.in`,
    name: 'System Administrator',
    mobile: '9999999999',
    role: 'admin',
    status: 'APPROVED',
    office: 'All Offices',
    counter: 'All Counters',
    passwordHash: cred.hash,
    salt: cred.salt,
    createdAt: new Date().toISOString(),
    approvedBy: 'Auto-Provisioned (.env)',
    approvedAt: new Date().toISOString()
  };
  await createUser(adminUser);
  console.log(`[AUTH] Initial administrator account "${adminUsername}" provisioned.`);
}

// ==========================================
// Queue State & Mutations (Single Source of Truth)
// ==========================================

async function getQueueState(office = null) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    const servingQuery = { status: 'SERVING' };
    const waitingQuery = { status: 'WAITING' };
    const completedQuery = { status: 'COMPLETED' };
    if (office && office !== 'All Offices') {
      servingQuery.office = office;
      waitingQuery.office = office;
      completedQuery.office = office;
    }

    const [currentServing, waitingTokens, completedTokens, meta] = await Promise.all([
      tokensCol.findOne(servingQuery),
      tokensCol.find(waitingQuery).sort({ createdAt: 1 }).toArray(),
      tokensCol.find(completedQuery).sort({ completedAt: -1 }).limit(50).toArray(),
      metadataCol.findOne({ _id: 'queue_meta' })
    ]);

    return {
      currentServing: currentServing || null,
      tokens: waitingTokens || [],
      completedTokens: completedTokens || [],
      nextTokenNum: meta ? meta.nextTokenNum : 44,
      completedCount: meta ? meta.completedCount : 24,
      walkinCount: meta ? meta.walkinCount : 1,
      soundEnabled: meta ? meta.soundEnabled !== false : true
    };
  }

  if (office && office !== 'All Offices') {
    return {
      currentServing: (fileState.currentServing && fileState.currentServing.office === office) ? fileState.currentServing : null,
      tokens: fileState.tokens.filter(t => t.office === office),
      completedTokens: fileState.completedTokens.filter(t => t.office === office),
      nextTokenNum: fileState.nextTokenNum,
      completedCount: fileState.completedCount,
      walkinCount: fileState.walkinCount,
      soundEnabled: fileState.soundEnabled
    };
  }

  return fileState;
}

async function getStats(office = null) {
  const state = await getQueueState(office);
  const waiting = state.tokens.filter(t => t.status === 'WAITING').length;
  const serving = (state.currentServing && state.currentServing.status === 'SERVING') ? 1 : 0;

  return {
    waiting,
    serving,
    completed: state.completedCount,
    walkins: state.walkinCount,
    currentServingId: state.currentServing ? state.currentServing.id : 'None',
    currentServingToken: state.currentServing
  };
}

async function hasActiveTokenForService(mobile, service) {
  if (!mobile || !service) return false;
  const cleanMobile = String(mobile).replace(/\D/g, '');
  if (!cleanMobile) return false;

  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const count = await tokensCol.countDocuments({
      service,
      status: { $in: ['WAITING', 'SERVING'] },
      $or: [
        { mobile: cleanMobile },
        { mobile: { $regex: cleanMobile } }
      ]
    });
    return count > 0;
  }

  const inWaiting = fileState.tokens.some(t => {
    const tMobile = String(t.mobile || '').replace(/\D/g, '');
    return tMobile === cleanMobile && t.service === service && t.status === 'WAITING';
  });

  const inServing = fileState.currentServing &&
    String(fileState.currentServing.mobile || '').replace(/\D/g, '') === cleanMobile &&
    fileState.currentServing.service === service &&
    fileState.currentServing.status === 'SERVING';

  return inWaiting || inServing;
}

// Add Token (Citizen or Walk-in)
async function addToken({
  service = 'Income Certificate',
  office = 'Rajkot District Service Center',
  mobile = '',
  customerName = 'Citizen',
  type = 'ONLINE',
  isDemo = false
}) {
  const cleanMobile = String(mobile).replace(/\D/g, '');

  if (isMongoConnected && mongoDb) {
    const metadataCol = mongoDb.collection('metadata');
    const tokensCol = mongoDb.collection('tokens');

    const meta = await metadataCol.findOneAndUpdate(
      { _id: 'queue_meta' },
      { $inc: { nextTokenNum: 1, ...(type === 'WALK-IN' ? { walkinCount: 1 } : {}) } },
      { upsert: true, returnDocument: 'after' }
    );

    const tokenNum = meta ? meta.nextTokenNum - 1 : Math.floor(Math.random() * 500) + 50;
    const tokenId = `A-${tokenNum}`;

    const newToken = {
      id: tokenId,
      type: type || 'ONLINE',
      service,
      office,
      customerName: customerName || (type === 'WALK-IN' ? 'Walk-in Citizen' : 'Citizen'),
      mobile: cleanMobile,
      status: 'WAITING',
      isDemo: !!isDemo,
      createdAt: new Date().toISOString()
    };

    await tokensCol.insertOne(newToken);
    await logActivity('TOKEN_CREATED', { name: customerName, role: type === 'WALK-IN' ? 'officer' : 'citizen' }, {
      tokenId,
      service,
      office,
      type
    });

    const state = await getQueueState(office);
    return { token: newToken, state };
  }

  const tokenNum = fileState.nextTokenNum++;
  const tokenId = `A-${tokenNum}`;

  const newToken = {
    id: tokenId,
    type: type || 'ONLINE',
    service,
    office,
    customerName: customerName || (type === 'WALK-IN' ? 'Walk-in Citizen' : 'Citizen'),
    mobile: cleanMobile,
    status: 'WAITING',
    isDemo: !!isDemo,
    createdAt: new Date().toISOString()
  };

  if (type === 'WALK-IN') {
    fileState.walkinCount += 1;
  }

  fileState.tokens.push(newToken);
  saveFile(QUEUE_FILE, fileState);

  await logActivity('TOKEN_CREATED', { name: customerName, role: type === 'WALK-IN' ? 'officer' : 'citizen' }, {
    tokenId,
    service,
    office,
    type
  });

  return { token: newToken, state: fileState };
}

// Call Next
async function callNext(counter = 'Counter 2', targetTokenId = null, actor = { name: 'Counter Officer', role: 'officer' }) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');

    const prevServing = await tokensCol.findOne({ status: 'SERVING' });
    if (prevServing) {
      await tokensCol.updateOne(
        { id: prevServing.id },
        { $set: { status: 'COMPLETED', completedAt: new Date().toISOString() } }
      );
      const metadataCol = mongoDb.collection('metadata');
      await metadataCol.updateOne({ _id: 'queue_meta' }, { $inc: { completedCount: 1 } });
    }

    let nextToken = null;
    if (targetTokenId) {
      nextToken = await tokensCol.findOne({ id: targetTokenId, status: 'WAITING' });
    }
    if (!nextToken) {
      nextToken = await tokensCol.findOne({ status: 'WAITING' }, { sort: { createdAt: 1 } });
    }

    if (!nextToken) {
      throw new Error('No waiting customers in queue.');
    }

    const calledAt = new Date().toISOString();
    await tokensCol.updateOne(
      { id: nextToken.id },
      { $set: { status: 'SERVING', counter: counter || 'Counter 2', calledAt } }
    );

    nextToken.status = 'SERVING';
    nextToken.counter = counter || 'Counter 2';
    nextToken.calledAt = calledAt;

    await logActivity('TOKEN_CALLED', actor, {
      tokenId: nextToken.id,
      counter: nextToken.counter,
      service: nextToken.service
    });

    const state = await getQueueState();
    return { calledToken: nextToken, state };
  }

  if (fileState.currentServing && fileState.currentServing.status === 'SERVING') {
    const completed = {
      ...fileState.currentServing,
      status: 'COMPLETED',
      completedAt: new Date().toISOString()
    };
    fileState.completedTokens.unshift(completed);
    fileState.completedCount += 1;
    fileState.currentServing = null;
  }

  let tokenIndex = -1;
  if (targetTokenId) {
    tokenIndex = fileState.tokens.findIndex(t => t.id === targetTokenId && t.status === 'WAITING');
  }
  if (tokenIndex === -1) {
    tokenIndex = fileState.tokens.findIndex(t => t.status === 'WAITING');
  }

  if (tokenIndex === -1) {
    throw new Error('No waiting customers in queue.');
  }

  const [called] = fileState.tokens.splice(tokenIndex, 1);
  called.status = 'SERVING';
  called.counter = counter || 'Counter 2';
  called.calledAt = new Date().toISOString();

  fileState.currentServing = called;
  saveFile(QUEUE_FILE, fileState);

  await logActivity('TOKEN_CALLED', actor, {
    tokenId: called.id,
    counter: called.counter,
    service: called.service
  });

  return { calledToken: called, state: fileState };
}

// Complete Current
async function completeCurrent(actor = { name: 'Counter Officer', role: 'officer' }) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    const currentServing = await tokensCol.findOne({ status: 'SERVING' });
    if (!currentServing) {
      throw new Error('No customer currently being served.');
    }

    const completedAt = new Date().toISOString();
    await tokensCol.updateOne(
      { id: currentServing.id },
      { $set: { status: 'COMPLETED', completedAt } }
    );
    await metadataCol.updateOne({ _id: 'queue_meta' }, { $inc: { completedCount: 1 } });

    currentServing.status = 'COMPLETED';
    currentServing.completedAt = completedAt;

    await logActivity('TOKEN_COMPLETED', actor, {
      tokenId: currentServing.id,
      counter: currentServing.counter || 'Counter 2'
    });

    const state = await getQueueState();
    return { completedToken: currentServing, state };
  }

  if (!fileState.currentServing || fileState.currentServing.status !== 'SERVING') {
    throw new Error('No customer currently being served.');
  }

  const completed = {
    ...fileState.currentServing,
    status: 'COMPLETED',
    completedAt: new Date().toISOString()
  };
  fileState.completedTokens.unshift(completed);
  fileState.completedCount += 1;
  fileState.currentServing = null;
  saveFile(QUEUE_FILE, fileState);

  await logActivity('TOKEN_COMPLETED', actor, {
    tokenId: completed.id,
    counter: completed.counter || 'Counter 2'
  });

  return { completedToken: completed, state: fileState };
}

// Mark No-Show
async function markNoShow(tokenId, actor = { name: 'Officer', role: 'officer' }) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const token = await tokensCol.findOne({ id: tokenId });
    if (!token) {
      throw new Error(`Token ${tokenId} not found.`);
    }

    await tokensCol.updateOne(
      { id: tokenId },
      { $set: { status: 'NO_SHOW', updatedAt: new Date().toISOString() } }
    );
    token.status = 'NO_SHOW';

    await logActivity('TOKEN_NOSHOW', actor, { tokenId });
    const state = await getQueueState();
    return { token, state };
  }

  if (fileState.currentServing && fileState.currentServing.id === tokenId) {
    const finished = { ...fileState.currentServing, status: 'NO_SHOW' };
    fileState.currentServing = null;
    saveFile(QUEUE_FILE, fileState);
    await logActivity('TOKEN_NOSHOW', actor, { tokenId });
    return { token: finished, state: fileState };
  }

  const idx = fileState.tokens.findIndex(t => t.id === tokenId);
  if (idx !== -1) {
    const [t] = fileState.tokens.splice(idx, 1);
    t.status = 'NO_SHOW';
    saveFile(QUEUE_FILE, fileState);
    await logActivity('TOKEN_NOSHOW', actor, { tokenId });
    return { token: t, state: fileState };
  }
  throw new Error(`Token ${tokenId} not found in active queue.`);
}

// Cancel Token
async function cancelToken(tokenId, actor = { name: 'Citizen', role: 'citizen' }) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const token = await tokensCol.findOne({ id: tokenId });
    if (!token) {
      throw new Error(`Token ${tokenId} not found.`);
    }

    await tokensCol.updateOne(
      { id: tokenId },
      { $set: { status: 'CANCELLED', updatedAt: new Date().toISOString() } }
    );
    token.status = 'CANCELLED';

    await logActivity('TOKEN_CANCELLED', actor, { tokenId });
    const state = await getQueueState();
    return { token, state };
  }

  const idx = fileState.tokens.findIndex(t => t.id === tokenId);
  if (idx !== -1) {
    const [t] = fileState.tokens.splice(idx, 1);
    t.status = 'CANCELLED';
    saveFile(QUEUE_FILE, fileState);
    await logActivity('TOKEN_CANCELLED', actor, { tokenId });
    return { token: t, state: fileState };
  }

  if (fileState.currentServing && fileState.currentServing.id === tokenId) {
    const t = fileState.currentServing;
    t.status = 'CANCELLED';
    fileState.currentServing = null;
    saveFile(QUEUE_FILE, fileState);
    await logActivity('TOKEN_CANCELLED', actor, { tokenId });
    return { token: t, state: fileState };
  }
  throw new Error(`Token ${tokenId} not found in waiting queue.`);
}

// Explicit Demo Queue Seeder (Never auto-wipes existing user data!)
async function seedDemoData({ office = 'Rajkot District Service Center', force = false } = {}) {
  const current = await getQueueState(office);
  const waitingCount = current.tokens.filter(t => t.status === 'WAITING').length;

  if (waitingCount >= 3 && !force) {
    return {
      seeded: false,
      message: `Queue already contains ${waitingCount} waiting tokens. Seeding skipped to prevent duplicates.`,
      state: current
    };
  }

  const demoBatch = [
    { name: 'Amit Verma', service: 'Income Certificate', type: 'ONLINE', mobile: '9823456789' },
    { name: 'Suresh Mehta', service: 'Residence Certificate', type: 'WALK-IN', mobile: '9834567890' },
    { name: 'Neha Gupta', service: 'Birth Certificate', type: 'ONLINE', mobile: '9845678901' },
    { name: 'Ramesh Dave', service: 'Caste Certificate', type: 'ONLINE', mobile: '9856789012' }
  ];

  for (const item of demoBatch) {
    await addToken({
      service: item.service,
      office,
      mobile: item.mobile,
      customerName: item.name,
      type: item.type,
      isDemo: true
    });
  }

  await logActivity('DEMO_SEEDED', { name: 'Demo Runner', role: 'admin' }, { office, count: demoBatch.length });
  const updatedState = await getQueueState(office);
  return {
    seeded: true,
    count: demoBatch.length,
    state: updatedState
  };
}

// Reset Queue
async function resetQueue(office = 'Rajkot District Service Center') {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    await tokensCol.deleteMany({});
    const seedTokens = [
      DEFAULT_STATE.currentServing,
      ...DEFAULT_STATE.tokens,
      ...DEFAULT_STATE.completedTokens
    ];
    await tokensCol.insertMany(seedTokens);
    await metadataCol.updateOne(
      { _id: 'queue_meta' },
      {
        $set: {
          nextTokenNum: DEFAULT_STATE.nextTokenNum,
          completedCount: DEFAULT_STATE.completedCount,
          walkinCount: DEFAULT_STATE.walkinCount,
          soundEnabled: true
        }
      },
      { upsert: true }
    );
    return await getQueueState(office);
  }

  fileState = JSON.parse(JSON.stringify(DEFAULT_STATE));
  saveFile(QUEUE_FILE, fileState);
  return fileState;
}

// Global Filtered Tokens for Admin Queue Monitor
async function getAllTokensFiltered({
  office = '',
  service = '',
  counter = '',
  status = '',
  date = '',
  limit = 100
} = {}) {
  let allTokens = [];

  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const query = {};
    if (office && office !== 'All Offices') query.office = office;
    if (service && service !== 'All Services') query.service = service;
    if (counter) query.counter = counter;
    if (status) query.status = status;
    if (date) {
      query.createdAt = { $regex: `^${date}` };
    }
    return await tokensCol.find(query).sort({ createdAt: -1 }).limit(Number(limit)).toArray();
  }

  // File fallback
  if (fileState.currentServing) {
    allTokens.push(fileState.currentServing);
  }
  allTokens = allTokens.concat(fileState.tokens).concat(fileState.completedTokens);

  return allTokens.filter(t => {
    if (office && office !== 'All Offices' && t.office !== office) return false;
    if (service && service !== 'All Services' && t.service !== service) return false;
    if (counter && t.counter !== counter) return false;
    if (status && t.status !== status) return false;
    if (date && t.createdAt && !t.createdAt.startsWith(date)) return false;
    return true;
  }).slice(0, Number(limit));
}

// Get Governance Metrics for Admin
async function getQueueMetrics(office = null) {
  const state = await getQueueState(office);
  const waitingTokens = state.tokens.filter(t => t.status === 'WAITING');
  const avgWaitMinutes = waitingTokens.length * 5;

  return {
    waitingCount: waitingTokens.length,
    servingCount: state.currentServing ? 1 : 0,
    completedCount: state.completedCount,
    walkinCount: state.walkinCount,
    estimatedWaitMinutes: avgWaitMinutes
  };
}

// ==========================================
// Appointments
// ==========================================

async function createAppointment({ office, service, date, slot, name, mobile }) {
  if (!office || !service || !date || !slot || !name || !mobile) {
    throw new Error('All appointment fields (office, service, date, slot, name, mobile) are required.');
  }

  const id = `APT-${Date.now().toString().slice(-4)}`;
  const cleanMobile = String(mobile).replace(/\D/g, '');

  const newApt = {
    id,
    office,
    service,
    date,
    slot,
    name,
    mobile: cleanMobile,
    status: 'CONFIRMED',
    createdAt: new Date().toISOString()
  };

  if (isMongoConnected && mongoDb) {
    const appointmentsCol = mongoDb.collection('appointments');
    await appointmentsCol.insertOne(newApt);
  } else {
    fileAppointments.unshift(newApt);
    saveFile(APPOINTMENTS_FILE, fileAppointments);
  }

  await logActivity('APPOINTMENT_BOOKED', { name, role: 'citizen' }, {
    appointmentId: id,
    office,
    service,
    slot,
    date
  });

  return newApt;
}

async function getAppointments() {
  if (isMongoConnected && mongoDb) {
    const appointmentsCol = mongoDb.collection('appointments');
    return await appointmentsCol.find().sort({ createdAt: -1 }).toArray();
  }
  return fileAppointments;
}

// ==========================================
// Office, Service & Counter Management
// ==========================================

async function getOffices() {
  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    return await officesCol.find().toArray();
  }
  return fileOffices;
}

async function addOffice({ name, tagline, district, services = [] }) {
  if (!name || !name.trim()) throw new Error('Office name is required.');
  const id = `OFF-${String(Date.now()).slice(-4)}`;
  const newOffice = {
    id,
    name: name.trim(),
    tagline: tagline ? tagline.trim() : 'District Seva Kendra',
    district: district ? district.trim() : 'Gujarat',
    services: services.length ? services : ['Income Certificate', 'Residence Certificate'],
    counters: [
      { id: `C-${id}-01`, name: 'Counter 1', service: 'General Inquiries', officerId: null, officerName: 'Standby' }
    ]
  };

  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    await officesCol.insertOne(newOffice);
  } else {
    fileOffices.push(newOffice);
    saveFile(OFFICES_FILE, fileOffices);
  }

  await logActivity('OFFICE_ADDED', { name: 'Administrator', role: 'admin' }, { officeId: id, name });
  return newOffice;
}

async function addServiceToOffice(officeId, serviceName) {
  if (!serviceName || !serviceName.trim()) throw new Error('Service name is required.');
  const sName = serviceName.trim();

  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    await officesCol.updateOne({ id: officeId }, { $addToSet: { services: sName } });
  } else {
    const off = fileOffices.find(o => o.id === officeId);
    if (!off) throw new Error('Office not found.');
    if (!off.services.includes(sName)) {
      off.services.push(sName);
      saveFile(OFFICES_FILE, fileOffices);
    }
  }

  await logActivity('SERVICE_ADDED', { name: 'Administrator', role: 'admin' }, { officeId, service: sName });
  return { success: true, service: sName };
}

async function addCounterToOffice(officeId, { name, service }) {
  if (!name || !name.trim()) throw new Error('Counter name is required.');
  const cId = `C-${Date.now().toString().slice(-4)}`;
  const counterObj = {
    id: cId,
    name: name.trim(),
    service: service ? service.trim() : 'General Services',
    officerId: null,
    officerName: 'Standby'
  };

  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    await officesCol.updateOne({ id: officeId }, { $push: { counters: counterObj } });
  } else {
    const off = fileOffices.find(o => o.id === officeId);
    if (!off) throw new Error('Office not found.');
    off.counters.push(counterObj);
    saveFile(OFFICES_FILE, fileOffices);
  }

  await logActivity('COUNTER_ADDED', { name: 'Administrator', role: 'admin' }, { officeId, counterId: cId, name });
  return counterObj;
}

async function assignCounterOfficer(officeId, counterId, officerId, officerName) {
  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    await officesCol.updateOne(
      { id: officeId, 'counters.id': counterId },
      {
        $set: {
          'counters.$.officerId': officerId || null,
          'counters.$.officerName': officerName || 'Standby'
        }
      }
    );
  } else {
    const off = fileOffices.find(o => o.id === officeId);
    if (!off) throw new Error('Office not found.');
    const counter = off.counters.find(c => c.id === counterId);
    if (counter) {
      counter.officerId = officerId || null;
      counter.officerName = officerName || 'Standby';
      saveFile(OFFICES_FILE, fileOffices);
    }
  }

  await logActivity('COUNTER_ASSIGNED', { name: 'Administrator', role: 'admin' }, { officeId, counterId, officerName });
  return { success: true };
}

// ==========================================
// User & Staff Management
// ==========================================

async function getUsers(filter = {}) {
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    return await usersCol.find(filter, { projection: { passwordHash: 0, salt: 0 } }).toArray();
  }
  return fileUsers.map(u => {
    const { passwordHash, salt, ...safe } = u;
    return safe;
  }).filter(u => {
    if (filter.role && u.role !== filter.role) return false;
    if (filter.status && u.status !== filter.status) return false;
    return true;
  });
}

async function getUserById(id) {
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    return await usersCol.findOne({ id });
  }
  return fileUsers.find(u => u.id === id) || null;
}

async function getUserByIdentifier(identifier) {
  if (!identifier) return null;
  const clean = identifier.trim().toLowerCase();

  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    return await usersCol.findOne({
      $or: [
        { username: { $regex: `^${clean}$`, $options: 'i' } },
        { email: { $regex: `^${clean}$`, $options: 'i' } }
      ]
    });
  }

  return fileUsers.find(u =>
    (u.username && u.username.toLowerCase() === clean) ||
    (u.email && u.email.toLowerCase() === clean)
  ) || null;
}

async function getUserByRole(role) {
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    return await usersCol.findOne({ role });
  }
  return fileUsers.find(u => u.role === role) || null;
}

async function createUser(userData) {
  const existing = await getUserByIdentifier(userData.username || userData.email);
  if (existing) {
    throw new Error('Username or email is already registered.');
  }

  const id = userData.id || `USR-${Date.now().toString().slice(-6)}`;
  const newUser = {
    ...userData,
    id,
    createdAt: new Date().toISOString()
  };

  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    await usersCol.insertOne(newUser);
  } else {
    fileUsers.push(newUser);
    saveFile(USERS_FILE, fileUsers);
  }

  await logActivity('STAFF_REGISTERED', { name: newUser.name, role: newUser.role }, {
    userId: id,
    status: newUser.status,
    office: newUser.office
  });

  const { passwordHash, salt, ...safeUser } = newUser;
  return safeUser;
}

async function approveStaff(userId, adminActor) {
  const user = await getUserById(userId);
  if (!user) throw new Error('Staff member not found.');

  const now = new Date().toISOString();
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    await usersCol.updateOne(
      { id: userId },
      { $set: { status: 'APPROVED', approvedBy: adminActor.name, approvedAt: now } }
    );
  } else {
    user.status = 'APPROVED';
    user.approvedBy = adminActor.name;
    user.approvedAt = now;
    saveFile(USERS_FILE, fileUsers);
  }

  await logActivity('STAFF_APPROVED', adminActor, {
    staffId: userId,
    staffName: user.name,
    office: user.office
  });

  return { success: true, user: { ...user, status: 'APPROVED' } };
}

async function rejectStaff(userId, adminActor) {
  const user = await getUserById(userId);
  if (!user) throw new Error('Staff member not found.');

  const now = new Date().toISOString();
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    await usersCol.updateOne(
      { id: userId },
      { $set: { status: 'REJECTED', rejectedBy: adminActor.name, rejectedAt: now } }
    );
  } else {
    user.status = 'REJECTED';
    user.rejectedBy = adminActor.name;
    user.rejectedAt = now;
    saveFile(USERS_FILE, fileUsers);
  }

  await logActivity('STAFF_REJECTED', adminActor, {
    staffId: userId,
    staffName: user.name
  });

  return { success: true, user: { ...user, status: 'REJECTED' } };
}

async function setStaffStatus(userId, status, adminActor) {
  const user = await getUserById(userId);
  if (!user) throw new Error('Staff member not found.');

  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    await usersCol.updateOne({ id: userId }, { $set: { status } });
  } else {
    user.status = status;
    saveFile(USERS_FILE, fileUsers);
  }

  await logActivity('STAFF_STATUS_CHANGED', adminActor, {
    staffId: userId,
    newStatus: status
  });

  return { success: true, user: { ...user, status } };
}

// ==========================================
// Session Management
// ==========================================

async function createSession(user) {
  const token = auth.generateToken();
  const session = {
    token,
    userId: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    status: user.status || 'APPROVED',
    office: user.office,
    counter: user.counter,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600000).toISOString() // 24 Hours
  };

  if (isMongoConnected && mongoDb) {
    const sessionsCol = mongoDb.collection('sessions');
    await sessionsCol.insertOne(session);
  } else {
    fileSessions[token] = session;
    saveFile(SESSIONS_FILE, fileSessions);
  }

  return session;
}

async function getSession(token) {
  if (!token) return null;

  let session = null;
  if (isMongoConnected && mongoDb) {
    const sessionsCol = mongoDb.collection('sessions');
    session = await sessionsCol.findOne({ token });
  } else {
    session = fileSessions[token] || null;
  }

  if (!session) return null;

  if (new Date(session.expiresAt) < new Date()) {
    await deleteSession(token);
    return null;
  }

  // Real-time synchronization with current user profile
  if (session.userId) {
    const user = await getUserById(session.userId);
    if (user && user.status) {
      session.status = user.status;
    }
  }

  return session;
}

async function deleteSession(token) {
  if (!token) return;
  if (isMongoConnected && mongoDb) {
    const sessionsCol = mongoDb.collection('sessions');
    await sessionsCol.deleteOne({ token });
  } else {
    delete fileSessions[token];
    saveFile(SESSIONS_FILE, fileSessions);
  }
}

// ==========================================
// Audit & Activity Logs
// ==========================================

async function logActivity(action, actor = { name: 'System', role: 'system' }, details = {}) {
  const logItem = {
    id: `LOG-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    action,
    actor: {
      name: actor.name || 'Unknown',
      role: actor.role || 'system'
    },
    details
  };

  if (isMongoConnected && mongoDb) {
    try {
      const activityCol = mongoDb.collection('activity');
      await activityCol.insertOne(logItem);
    } catch (e) {}
  } else {
    fileActivityLogs.unshift(logItem);
    if (fileActivityLogs.length > 500) {
      fileActivityLogs = fileActivityLogs.slice(0, 500);
    }
    saveFile(ACTIVITY_FILE, fileActivityLogs);
  }

  return logItem;
}

async function getActivityLogs({ limit = 50, action = null } = {}) {
  if (isMongoConnected && mongoDb) {
    const activityCol = mongoDb.collection('activity');
    const query = action ? { action } : {};
    return await activityCol.find(query).sort({ timestamp: -1 }).limit(Number(limit)).toArray();
  }

  let logs = fileActivityLogs;
  if (action) {
    logs = logs.filter(l => l.action === action);
  }
  return logs.slice(0, Number(limit));
}

// Close connection
async function closeDatabase() {
  if (mongoClient) {
    await mongoClient.close();
    isMongoConnected = false;
  }
}

module.exports = {
  initDatabase,
  getDatabaseStatus,
  getQueueState,
  getStats,
  hasActiveTokenForService,
  addToken,
  callNext,
  completeCurrent,
  markNoShow,
  cancelToken,
  seedDemoData,
  resetQueue,
  getAllTokensFiltered,
  getQueueMetrics,
  createAppointment,
  getAppointments,
  getOffices,
  addOffice,
  addServiceToOffice,
  addCounterToOffice,
  assignCounterOfficer,
  getUsers,
  getUserById,
  getUserByIdentifier,
  getUserByRole,
  createUser,
  approveStaff,
  rejectStaff,
  setStaffStatus,
  createSession,
  getSession,
  deleteSession,
  logActivity,
  getActivityLogs,
  closeDatabase,
  DEFAULT_STATE,
  DEFAULT_OFFICES
};
