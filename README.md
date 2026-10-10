# QueueLess — Virtual Queue & Appointment Management System

> **Tagline:** *Join the Queue. Not the Crowd.*  
> **Problem Statement:** PS-02 — Virtual Queue & Appointment Management System for Government Offices  
> **Target Department:** Jan Seva Kendra / District Administration (Civic-Tech)  
> **Status:** Production-Ready MVP (Single Backend Source of Truth, RBAC, Admin Dashboard & Deployment Ready)

---

## 🏛️ System Architecture & Roles

Smart Queue System provides an end-to-end, single-source-of-truth virtual queue architecture:

```
                               ┌─────────────────────────────────────────┐
                               │   Civic-Tech Single Source of Truth    │
                               │          Node.js Server (:3000)         │
                               └────────────────────┬────────────────────┘
                                                    │
                 ┌──────────────────────────────────┼──────────────────────────────────┐
                 │                                  │                                  │
                 ▼                                  ▼                                  ▼
      ┌─────────────────────┐            ┌─────────────────────┐            ┌─────────────────────┐
      │   CITIZEN PORTAL    │            │   OFFICER CONSOLE   │            │   ADMIN DASHBOARD   │
      │   (citizen.html)    │            │   (officer.html)    │            │    (admin.html)     │
      ├─────────────────────┤            ├─────────────────────┤            ├─────────────────────┤
      │ • Firebase Phone OTP│            │ • Bearer Session Auth│           │ • Master System Ctrl│
      │ • Doc Readiness Check│           │ • Desk Counter Ops  │            │ • Officer Approvals │
      │ • Virtual Token Issuance         │ • Offline Walk-in Issuance       │ • Office/Counter Config│
      │ • Dynamic Arrival Window         │ • Now Serving Chimes│            │ • Global Queue Monitor│
      │ • Digital QR Pass   │            │ • Call Next/Complete│            │ • Immutable Audit Logs│
      └─────────────────────┘            └─────────────────────┘            └─────────────────────┘
                 │                                  │                                  │
                 └──────────────────────────────────┴──────────────────────────────────┘
                                                    │
                                                    ▼
                                  ┌───────────────────────────────────┐
                                  │      Persistence Engine           │
                                  │  MongoDB Atlas / JSON Fallback    │
                                  │   (data/queue.json, users.json)   │
                                  └───────────────────────────────────┘
```

### Role-Based Access Control (RBAC) Matrix
| Role | Portal / Login Page | Privileges & Endpoint Access |
|---|---|---|
| **Citizen** | `citizen.html` / `login-citizen.html` | Issue virtual tokens via verified phone OTP (`POST /api/token`), view personal queue progress, cancel own token. Desk controls strictly blocked (HTTP 403). |
| **Officer** | `officer.html` / `login-officer.html` | Registered officers start in **PENDING** status until admin approval. Approved officers can operate assigned desks (`/api/queue/call-next`, `/api/queue/complete`, `/api/officer/walk-in`). |
| **Admin** | `admin.html` / `login-admin.html` | Full district administration: approve/reject officer applications, manage Kendra offices, assign counters, inspect filterable queue monitor, view immutable audit logs (`/api/admin/*`), seed demo queues without user loss. |

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Node.js (v18+ recommended)
- Zero external build steps required.

### 2. Environment Setup
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(When unconfigured, Smart Queue System runs in zero-crash local JSON persistence mode with Gujarat Kendra seed data.)*

### 3. Start the Server
```bash
npm start
# OR
node server.js
```
The server binds to `0.0.0.0:3000` (listening on all network interfaces for container and cloud readiness).

### 4. Default Demo & Evaluation Accounts
For instant testing and hackathon jury demonstrations:
| Role | Username | Password | Status | Notes |
|---|---|---|---|---|
| **Administrator** | `admin` | `Admin@1234` | **APPROVED** | Master administrator account |
| **Desk Officer 1** | `officer1` | `officer123` | **APPROVED** | Ready to call desk tokens |
| **Desk Officer 2** | `sneha_patel` | `staff123` | **PENDING** | Pre-configured to test approval workflow |

---

## 🧪 Comprehensive Automated Test Suite (14 Scenarios)

Smart Queue System includes an automated acceptance test suite that validates every backend constraint, role-based boundary, and persistence requirement:

```bash
node test-suite.js
```

### Verified Test Scenarios (50/50 Assertions Passing):
1. **Scenario 1:** Admin Provisioning & Session Token Verification.
2. **Scenario 2:** Officer Registration (Sets initial status to `PENDING`).
3. **Scenario 3:** Pending Officer Blocked from Login (`HTTP 403 ACCOUNT_PENDING`) & Unauthenticated Desk Operations Blocked (`HTTP 401`).
4. **Scenario 4:** Admin Approves Officer via Admin API.
5. **Scenario 5:** Approved Officer Login & Authorized Desk Operation (Offline Walk-in).
6. **Scenario 6:** Admin Deactivates Staff (`HTTP 403` on subsequent desk operations).
7. **Scenario 7:** Citizen Token Creation with Mobile Check & Anti-Duplicate Protection.
8. **Scenario 8:** Global Unified Queue Visibility across Citizen & Officer views.
9. **Scenario 9:** Server Restart Persistence (Tokens survive process termination without data loss).
10. **Scenario 10:** Counter Call Next State Transition (`WAITING` &rarr; `SERVING`).
11. **Scenario 11:** Service Completion Transition (`SERVING` &rarr; `COMPLETED`) & Metric Increment.
12. **Scenario 12:** Admin Multi-Office, Counters & Filterable Queue Monitor Query.
13. **Scenario 13:** Explicit Demo Seed Without Staff Loss (`/api/queue/seed`).
14. **Scenario 14:** Deployment Readiness & Health Diagnostics (`GET /api/health`).

---

## 🎬 Step-by-Step Jury Demonstration Script (3 Minutes)

### Step 1: Citizen Mobile Booking (Citizen Portal)
1. Open **`citizen.html`** (or open **`demo-split.html`** for side-by-side execution).
2. Select **Rajkot District Service Center** and **Income Certificate**.
3. Review the **Document Readiness Checklist** (Aadhaar, Ration Card, Salary Slip, Electricity Bill).
4. Enter mobile `9876543210` and verify with SMS OTP `123456`.
5. Click **Verify & Get Token**. Citizen is issued virtual token **`A-44`** with an estimated wait of 15 minutes and a smart arrival window (e.g. *3:45 PM – 3:55 PM*).

### Step 2: Officer Desk Operations (Officer Console)
1. Open **`login-officer.html`** and click **Pre-fill Approved** (`officer1` / `officer123`).
2. Once signed in to **`officer.html`**, notice `A-44` waiting in the Unified Queue.
3. Click **+ Add Walk-in**, enter name `Rahul Patel`, and submit. Walk-in token **`A-45`** is issued.
4. Verify the **Unified Queue**: online token `A-44` and physical walk-in `A-45` reside in the identical fair sequence.
5. Click **CALL NEXT**: Desk chime rings, Counter 2 displays **`NOW SERVING: A-41`**, and the citizen portal automatically recalculates waiting positions in real time!
6. Click **Complete**: Service is concluded, and metrics update.

### Step 3: Officer Approval Workflow (Admin Dashboard)
1. Open **`login-officer.html`**, click **Register as Officer**, and submit application for `ramesh_desk`.
2. Notice the warning: application is in **PENDING** status. Attempting to log in immediately returns an account pending message.
3. Open **`login-admin.html`** and sign in as `admin` / `Admin@1234`.
4. Navigate to **`admin.html`** &rarr; **Staff Approvals** tab.
5. `ramesh_desk` appears in **Pending Officer Applications**. Click **✓ Approve**.
6. Switch back to **`login-officer.html`**: `ramesh_desk` can now immediately sign in and operate desks!

### Step 4: Multi-Office, Counters & Audit Logs
1. In **`admin.html`**, navigate to **Offices & Counters** tab to view Jan Seva Kendra locations and assign officers to desks.
2. Open **Global Queue Monitor** tab: filter live tokens by status (`ALL`, `WAITING`, `SERVING`, `COMPLETED`), office, or search keyword.
3. Open **Audit Activity Logs** tab: inspect the immutable chronological record of all logins, approvals, token issuances, and counter calls.

---

## ☁️ Deployment Instructions

Smart Queue System is designed to deploy to any cloud container or PaaS provider with zero friction.

### Health Check Endpoint
- Probe URL: `GET /api/health`
- Response:
```json
{
  "status": "UP",
  "service": "QueueLess Virtual Queue System",
  "uptime": 124.5,
  "timestamp": "2026-10-10T12:00:00.000Z",
  "database": {
    "engine": "JSON_FILE_STORAGE",
    "connected": true
  },
  "host": "0.0.0.0",
  "port": 3000
}
```

### Deploying to Render / Railway / Heroku
1. Push this repository to GitHub or GitLab.
2. In your cloud provider dashboard:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment Variables:**
     - `HOST=0.0.0.0`
     - `PORT=3000` (or leave default assigned by provider)
     - `ADMIN_USERNAME=admin`
     - `ADMIN_INITIAL_PASSWORD=YourStrongPassword`
     - `REQUIRE_OFFICER_AUTH=true`
     - `MONGODB_URI=mongodb+srv://...` (Optional, defaults to local JSON storage if omitted)

### Deploying with Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
ENV HOST=0.0.0.0
ENV PORT=3000
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t queueless .
docker run -p 3000:3000 queueless
```

---

## 🔒 Security Compliance
- **Zero Secret Exposure:** Credentials, MongoDB connection strings, and Firebase service accounts are loaded strictly via environment variables.
- **Timing-Safe Password Verification:** Password hashes are computed using Node.js native `crypto.scryptSync` with random salts and verified via `crypto.timingSafeEqual`.
- **Session Revocation:** Sessions query live user status on every authorized desk call; deactivating a staff member in the Admin Dashboard immediately revokes desk permissions.
