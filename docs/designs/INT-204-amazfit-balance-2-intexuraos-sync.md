# Amazfit Balance 2 Watch App Design for IntexuraOS Data Sync

**Linear Issue:** [INT-204](https://linear.app/pbuchman/issue/INT-204/feature-design-amazfit-balance-2-watch-app-for-intexuraos-data-sync)
**Status:** Initial Design Phase
**Last Updated:** 2026-01-22

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Device Specifications](#device-specifications)
3. [Zepp OS Platform Overview](#zepp-os-platform-overview)
4. [Available Health Data APIs](#available-health-data-apis)
5. [Architectural Options](#architectural-options)
6. [Complexity Analysis](#complexity-analysis)
7. [Security Considerations](#security-considerations)
8. [Recommendation](#recommendation)
9. [Implementation Roadmap](#implementation-roadmap)
10. [References](#references)

---

## Executive Summary

This document analyzes the design and implementation options for creating a native Amazfit Balance 2 watch application that syncs health and fitness data to IntexuraOS via API. The Amazfit Balance 2 runs Zepp OS 5.0 with API Level 4.2, supporting JavaScript-based Mini Program development.

**Key Finding:** Direct watch-to-server communication is not possible. The Zepp OS architecture requires a three-tier approach: Watch App → Phone App (Side Service via Bluetooth) → IntexuraOS API (via HTTP Fetch).

**Recommended Approach:** Option A - Native Zepp OS Mini Program with Side Service relay.

---

## Device Specifications

### Amazfit Balance 2 Hardware

| Specification           | Details                                  |
| ----------------------- | ---------------------------------------- |
| **Operating System**    | Zepp OS 5.0                              |
| **API Level**           | 4.2                                      |
| **Device Source IDs**   | `9568512*` (China), `9568513`, `9568515` |
| **Display**             | 47mm AMOLED, 480 × 480 pixels (round)    |
| **Physical Keys**       | 2                                        |
| **Storage**             | 4 GB built-in                            |
| **Connectivity**        | Wi-Fi 2.4GHz, Bluetooth 5.2 BLE          |
| **Water Resistance**    | 5 ATM (45m diving certified)             |
| **Battery Life**        | Up to 21 days typical use                |
| **GPS**                 | Dual-band (L1 + L5), 6 satellite systems |
| **Phone Compatibility** | Android 7.0+, iOS 15.0+                  |

### BioTracker 6.0 Sensor Array

The Amazfit Balance 2 features the latest BioTracker 6.0 PPG biometric sensor with:

- 8-point photodiode (8PD) sensor array
- 2 LED configuration
- Skin temperature sensor integration
- Comprehensive health metric generation

**Sensors Available:**

- BioTracker 6.0 PPG biometric sensor
- Acceleration sensor
- Gyroscope sensor
- Geomagnetic sensor
- Barometric altimeter
- Ambient light sensor
- Temperature sensor

---

## Zepp OS Platform Overview

### Development Framework

Zepp OS provides a "lightweight" JavaScript-based development framework for building:

- **Mini Programs** - Full applications with UI and sensor access
- **Watch Faces** - Custom watch face designs
- **Workout Extensions** - Sport-specific overlays (API Level 3.6+)

### Architecture Components

A complete Zepp OS Mini Program consists of three parts:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ZEPP OS MINI PROGRAM                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐                                                │
│  │     Device App      │  Runs on Amazfit Balance 2                     │
│  │                     │  • UI rendering (widgets)                      │
│  │                     │  • Sensor data access                          │
│  │                     │  • Local storage                               │
│  │                     │  • BLE communication (to Side Service)         │
│  └──────────┬──────────┘                                                │
│             │ Bluetooth (ZML Library)                                   │
│             ▼                                                           │
│  ┌─────────────────────┐                                                │
│  │    Side Service     │  Runs in Zepp App (Phone)                      │
│  │                     │  • No UI interface                             │
│  │                     │  • HTTP Fetch API (external servers)           │
│  │                     │  • Zepp App capabilities                       │
│  │                     │  • Persistent storage                          │
│  └──────────┬──────────┘                                                │
│             │ Settings Storage API                                      │
│             ▼                                                           │
│  ┌─────────────────────┐                                                │
│  │   Settings App      │  Runs in Zepp App (Phone) - OPTIONAL           │
│  │                     │  • Mobile UI for configuration                 │
│  │                     │  • User preferences                            │
│  │                     │  • Auth token storage                          │
│  └─────────────────────┘                                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Communication Protocols

| Path                           | Protocol             | Library       | Data Format          |
| ------------------------------ | -------------------- | ------------- | -------------------- |
| Device App ↔ Side Service      | Bluetooth Low Energy | ZML (v0.0.9+) | Binary (JSON bridge) |
| Side Service ↔ Settings App    | Settings Storage API | Native        | Key-value pairs      |
| Side Service ↔ External Server | HTTP/HTTPS           | Fetch API     | JSON                 |

### Critical Constraints

1. **No direct HTTP from watch**: Device App cannot make network requests directly
2. **BLE binary-only**: Raw Bluetooth API only supports binary data
3. **Side Service required**: External communication requires Side Service middleware
4. **Phone dependency**: Watch app functionality depends on paired phone connectivity
5. **Watch faces limitation**: Watch faces cannot use Side Service (Mini Programs only)

---

## Available Health Data APIs

### Sensor APIs (Device App)

All sensor APIs require appropriate permissions and API Level compatibility.

#### Heart Rate Sensor

| Method                | Description                              | API Level |
| --------------------- | ---------------------------------------- | --------- |
| `getCurrent()`        | Current HR during continuous measurement | 2.0+      |
| `getLast()`           | Most recent single measurement           | 2.0+      |
| `getToday()`          | Minute-by-minute data (max 1,440 points) | 2.0+      |
| `onCurrentChange(cb)` | Real-time HR updates                     | 2.1+      |
| `getDailySummary()`   | Daily max HR with timestamp              | 3.0+      |
| `getResting()`        | Resting heart rate                       | 3.0+      |
| `getAFibRecord()`     | Atrial fibrillation detection data       | 3.0+      |

**Permission:** `data:user.hd.heart_rate`

```javascript
import { HeartRate } from '@zos/sensor';

const heartRate = new HeartRate();
const lastValue = heartRate.getLast();
const todayData = heartRate.getToday(); // Array[1440]

const callback = () => {
  console.log(heartRate.getCurrent());
};
heartRate.onCurrentChange(callback);
```

#### Sleep Sensor

| Method                  | Description                          | API Level |
| ----------------------- | ------------------------------------ | --------- |
| `updateInfo()`          | Force refresh (default: 30 min auto) | 2.0+      |
| `getInfo()`             | Score, deep/total time, start/end    | 2.0+      |
| `getStageConstantObj()` | Sleep stage constants                | 2.0+      |
| `getStage()`            | Sleep staging data with timing       | 2.0+      |
| `getSleepingStatus()`   | Current awake/sleeping status        | 3.0+      |
| `getNap()`              | Nap session data                     | 3.0+      |

**Sleep Stages:** WAKE_STAGE, REM_STAGE, LIGHT_STAGE, DEEP_STAGE

```javascript
import { Sleep } from '@zos/sensor';

const sleep = new Sleep();
sleep.updateInfo(); // Force refresh

const info = sleep.getInfo();
// { score, deepTime, startTime, endTime, totalTime }

const stages = sleep.getStage();
// Array[{ model, start, stop }]
```

#### Stress Sensor

| Method                | Description                      | API Level |
| --------------------- | -------------------------------- | --------- |
| `getCurrent()`        | Current stress + timestamp       | 2.0+      |
| `getToday()`          | Minute-by-minute (max 1,440)     | 2.0+      |
| `getTodayByHour()`    | Hourly averages (24 elements)    | 2.0+      |
| `getLastWeek()`       | Daily averages (7 days)          | 2.0+      |
| `getLastWeekByHour()` | Hourly for 7 days (168 elements) | 2.0+      |
| `onChange(cb)`        | Real-time stress updates         | 2.0+      |

**Permission:** `data:user.hd.stress`

#### Blood Oxygen Sensor

| Method         | Description              | API Level |
| -------------- | ------------------------ | --------- |
| `start()`      | Begin SpO2 measurement   | 2.0+      |
| `stop()`       | End SpO2 measurement     | 2.0+      |
| `getCurrent()` | Get current SpO2 reading | 2.0+      |

#### Additional Sensors

| Sensor   | Key Methods                                 | Permission              |
| -------- | ------------------------------------------- | ----------------------- |
| Calorie  | `getCurrent()`, `getTarget()`               | `data:user.hd.calorie`  |
| PAI      | `getTotal()`, `getToday()`, `getLastWeek()` | `data:user.hd.pai`      |
| Step     | `getCurrent()`, `getTarget()`               | `data:user.hd.step`     |
| Distance | `getCurrent()`                              | `data:user.hd.distance` |
| Workout  | Navigation, real-time data                  | `data:user.hd.workout`  |

### Data Access Limitations

| Constraint               | Impact                                             |
| ------------------------ | -------------------------------------------------- |
| **Same-day data only**   | Most health sensors only return current day data   |
| **No historical export** | Cannot bulk-export past days                       |
| **App must run**         | Continuous monitoring requires Mini Program active |
| **30-min sleep refresh** | Sleep data auto-updates every 30 minutes           |
| **Permission prompts**   | First-time sensor access requires user approval    |

---

## Architectural Options

### Option A: Native Zepp OS Mini Program (Recommended)

**Architecture:**

```
┌──────────────┐     BLE      ┌──────────────┐    HTTPS     ┌─────────────┐
│   Balance 2  │────────────▶ │  Zepp App    │────────────▶ │ IntexuraOS  │
│  Device App  │◀──────────── │ Side Service │◀──────────── │    API      │
└──────────────┘              └──────────────┘              └─────────────┘
     Watch                         Phone                       Cloud
```

**Components:**

1. **Device App (Watch)**
   - UI for sync status and configuration
   - Collect sensor data (heart rate, sleep, stress, SpO2, steps)
   - Schedule periodic data collection (Alarm API)
   - Send data to Side Service via ZML

2. **Side Service (Phone)**
   - Receive data from Device App
   - Authenticate with IntexuraOS API
   - HTTP POST health data to IntexuraOS
   - Handle retry logic and offline queuing

3. **Settings App (Phone) - Optional**
   - IntexuraOS authentication UI
   - Sync frequency configuration
   - Data type selection

**Data Flow:**

```javascript
// Device App: Collect and send
import { Sleep, HeartRate, Stress } from '@zos/sensor';

function collectHealthData() {
  const sleep = new Sleep();
  const heartRate = new HeartRate();
  const stress = new Stress();

  const healthData = {
    timestamp: Date.now(),
    sleep: sleep.getInfo(),
    heartRate: {
      last: heartRate.getLast(),
      resting: heartRate.getResting(),
      today: heartRate.getToday(),
    },
    stress: stress.getCurrent(),
  };

  this.request({
    method: 'SYNC_HEALTH_DATA',
    params: healthData,
  }).then((response) => {
    showToast({ content: `Synced: ${response.status}` });
  });
}

// Side Service: Relay to IntexuraOS
async function handleSyncRequest(ctx, request) {
  const { params } = request;

  const response = await fetch({
    url: 'https://api.intexuraos.com/health/sync',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getStoredToken()}`,
    },
    body: JSON.stringify({
      deviceType: 'amazfit_balance_2',
      data: params,
    }),
  });

  ctx.response({ status: response.status });
}
```

**Pros:**

- Full control over data collection timing and format
- Native watch UI for user feedback
- Direct integration with IntexuraOS API contracts
- Real-time sync capability
- Offline data queuing possible
- User-controlled sync triggers

**Cons:**

- Requires Zepp App on paired phone
- Phone must be reachable for sync
- Development complexity (three components)
- App store approval required for distribution
- Bluetooth communication overhead

### Option B: Zepp App Cloud Relay via Terra API

**Architecture:**

```
┌──────────────┐              ┌──────────────┐              ┌─────────────┐
│   Balance 2  │  Automatic   │  Zepp Cloud  │   Webhook    │ IntexuraOS  │
│    Watch     │────────────▶ │    + Terra   │────────────▶ │    API      │
└──────────────┘              └──────────────┘              └─────────────┘
     Watch                    Third-Party                      Cloud
```

**Description:**

Terra API is a third-party service that integrates with Zepp's cloud platform. It provides normalized health data via webhooks when new data becomes available.

**Data Flow:**

1. User wears Balance 2, data syncs to Zepp App automatically
2. Zepp App syncs to Zepp Cloud
3. Terra API receives data from Zepp Cloud
4. Terra sends webhook to IntexuraOS with normalized data

**Pros:**

- No custom watch app development required
- Normalized data format across multiple wearable brands
- Automatic background sync
- No Mini Program maintenance burden

**Cons:**

- Third-party dependency (Terra API pricing)
- Data latency (not real-time, depends on Zepp sync frequency)
- Limited control over data granularity
- No custom watch UI
- User must authorize Terra + Zepp integration
- Privacy concerns (data flows through third party)
- No IntexuraOS branding on watch

### Option C: Reverse-Engineered Zepp Cloud API

**Architecture:**

```
┌──────────────┐              ┌──────────────┐              ┌─────────────┐
│   Balance 2  │  Automatic   │  Zepp Cloud  │   Unofficial │ IntexuraOS  │
│    Watch     │────────────▶ │              │◀──────────── │   Poller    │
└──────────────┘              └──────────────┘     API      └─────────────┘
     Watch                       Cloud                       Cloud
```

**Description:**

IntexuraOS backend periodically polls the unofficial Zepp/Huami API to retrieve health data. This approach reverse-engineers the API used by the Zepp mobile app.

**Known Endpoints:**

- `api-mifit-de2.huami.com/v1/sport/run/history.json` - Workout metadata
- Token obtained from Zepp App shared preferences (requires root or traffic sniffing)

**Pros:**

- No watch app development
- Full historical data access potentially available
- No Terra API costs
- Background operation without user action

**Cons:**

- **Unofficial/unsupported** - could break at any time
- **Terms of Service violation** likely
- Token acquisition problematic (user experience)
- API stability concerns (undocumented changes)
- Security/privacy concerns
- No real-time capability
- Legal/ethical implications

### Option D: Google Fit / Apple Health Bridge

**Architecture:**

```
┌──────────────┐              ┌──────────────┐              ┌─────────────┐
│   Balance 2  │  Zepp Sync   │ Google Fit/  │   Official   │ IntexuraOS  │
│    Watch     │────────────▶ │ Apple Health │◀──────────── │   Backend   │
└──────────────┘              └──────────────┘     API      └─────────────┘
     Watch                    Platform Health                 Cloud
```

**Description:**

Leverage existing Zepp integration with Google Fit (Android) or Apple Health (iOS). IntexuraOS backend integrates with these platform APIs.

**Pros:**

- Uses official, stable platform APIs
- No watch app development
- Data aggregated from multiple sources
- Well-documented APIs
- Existing user familiarity

**Cons:**

- Data granularity loss (platforms may aggregate/simplify)
- Platform-specific implementations required
- User must configure Zepp → Platform sync
- No custom watch experience
- Delayed data (depends on platform sync)
- Limited to what platforms expose

---

## Complexity Analysis

### Development Effort Matrix

| Option                     | Watch Dev | Phone Dev | Backend Dev | Maintenance | Total Score |
| -------------------------- | --------- | --------- | ----------- | ----------- | ----------- |
| A: Native Mini Program     | High      | Medium    | Low         | Medium      | **7/10**    |
| B: Terra API               | None      | None      | Medium      | Low         | **3/10**    |
| C: Reverse-Engineered API  | None      | None      | High        | High        | **6/10**    |
| D: Google Fit/Apple Health | None      | None      | Medium      | Low         | **3/10**    |

### Feature Comparison

| Feature                      | Option A | Option B | Option C | Option D |
| ---------------------------- | -------- | -------- | -------- | -------- |
| Real-time sync               | Yes      | No       | No       | No       |
| Custom watch UI              | Yes      | No       | No       | No       |
| Full data granularity        | Yes      | Partial  | Maybe    | Partial  |
| IntexuraOS branding          | Yes      | No       | No       | No       |
| No third-party dependency    | Yes      | No       | Yes      | No       |
| Official/supported approach  | Yes      | Yes      | No       | Yes      |
| Historical data access       | Limited  | Yes      | Yes      | Yes      |
| Offline capability           | Yes      | N/A      | N/A      | N/A      |
| Cross-platform (iOS+Android) | Yes      | Yes      | Yes      | Partial  |

### Risk Assessment

| Option                     | Technical Risk | Legal Risk | Business Risk | Overall  |
| -------------------------- | -------------- | ---------- | ------------- | -------- |
| A: Native Mini Program     | Medium         | Low        | Low           | **Low**  |
| B: Terra API               | Low            | Low        | Medium        | Medium   |
| C: Reverse-Engineered API  | High           | High       | High          | **High** |
| D: Google Fit/Apple Health | Low            | Low        | Medium        | Low      |

---

## Security Considerations

### Authentication Flow

For Option A (Native Mini Program), the authentication flow with IntexuraOS must be carefully designed.

**Recommended Approach: Device Authorization Flow**

IntexuraOS already supports Device Authorization Flow via `POST /auth/device/start` and `POST /auth/device/poll` (see [API Contracts](../architecture/api-contracts.md)).

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│  Settings App │     │   IntexuraOS  │     │   User's      │
│   (Phone UI)  │     │      API      │     │   Browser     │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        │  POST /auth/device/start                  │
        │────────────────────▶│                     │
        │                     │                     │
        │  { device_code,     │                     │
        │    user_code,       │                     │
        │    verification_uri }                     │
        │◀────────────────────│                     │
        │                     │                     │
        │  Display: "Go to    │                     │
        │  URL, enter code"   │                     │
        │─────────────────────│────────────────────▶│
        │                     │                     │
        │                     │  User authenticates │
        │                     │◀────────────────────│
        │                     │                     │
        │  POST /auth/device/poll                   │
        │────────────────────▶│                     │
        │                     │                     │
        │  { access_token }   │                     │
        │◀────────────────────│                     │
        │                     │                     │
        │  Store token in     │                     │
        │  Settings Storage   │                     │
        └─────────────────────┘                     │
```

### Token Storage

| Location         | Security Level | Recommendation |
| ---------------- | -------------- | -------------- |
| Device App       | Low            | Never store    |
| Settings Storage | Medium         | Encrypted      |
| Secure Storage   | High           | Preferred      |

### Data Protection

1. **In Transit:** All API calls use HTTPS
2. **At Rest:** Health data should be encrypted in IntexuraOS Firestore
3. **On Device:** Zepp OS provides sandboxed storage per app
4. **Token Refresh:** Implement automatic token refresh before expiry

### Privacy Compliance

- Health data is sensitive (GDPR Art. 9, HIPAA consideration)
- Explicit user consent required before each data type
- Clear privacy policy required for App Store approval
- Data retention and deletion policies needed

---

## Recommendation

### Primary Recommendation: Option A (Native Zepp OS Mini Program)

**Rationale:**

1. **Quality over simplicity** - As specified in requirements, Option A provides the highest quality user experience with full control over data granularity and sync timing.

2. **No third-party dependency** - Direct integration avoids ongoing costs and reliability risks of third-party services.

3. **Custom branding** - Watch UI reinforces IntexuraOS brand presence.

4. **Real-time capability** - Only option supporting immediate sync on user action.

5. **IntexuraOS API alignment** - Leverages existing Device Authorization Flow and API contracts.

6. **Official platform support** - Zepp OS Mini Programs are the intended developer path.

### Secondary Recommendation: Option D (Google Fit/Apple Health)

As a complementary approach, implementing Google Fit and Apple Health integration would:

- Provide historical data access
- Support users who prefer platform-level aggregation
- Reduce dependency on watch app for basic sync

### Not Recommended

- **Option B (Terra API)** - Third-party cost and dependency without significant benefit
- **Option C (Reverse-Engineered)** - Unacceptable legal and stability risks

---

## Implementation Roadmap

### Phase 1: Proof of Concept (Estimated: 2-3 weeks)

**Objective:** Validate technical feasibility

1. Set up Zepp OS development environment
   - Zeus CLI installation
   - Developer account registration
   - Simulator configuration

2. Create minimal Device App
   - Basic UI (single sync button)
   - Heart rate sensor access
   - ZML communication setup

3. Create minimal Side Service
   - Receive data from Device App
   - HTTP POST to test endpoint

4. Test on real device via Developer Mode

**Deliverables:**

- Working PoC syncing heart rate to test server
- Development environment documentation
- Technical feasibility report

### Phase 2: Core Development (Estimated: 4-6 weeks)

**Objective:** Build production-ready sync functionality

1. Device App development
   - Full sensor integration (sleep, stress, SpO2, steps)
   - Scheduling system (Alarm API)
   - Offline data queuing
   - Sync status UI

2. Side Service development
   - IntexuraOS API integration
   - Authentication handling
   - Retry logic with exponential backoff
   - Error handling and logging

3. Settings App development
   - Device Authorization Flow UI
   - Sync configuration (frequency, data types)
   - Connection status display

4. IntexuraOS backend updates
   - New health data endpoint
   - Firestore schema for health data
   - Data validation and storage

**Deliverables:**

- Feature-complete Mini Program
- IntexuraOS health data API
- Integration tests

### Phase 3: Polish & Distribution (Estimated: 2-3 weeks)

**Objective:** Prepare for production deployment

1. App Store submission
   - Privacy policy documentation
   - App screenshots and descriptions
   - Review compliance checklist

2. Testing
   - Multi-device testing (Balance 2 variants)
   - iOS and Android compatibility
   - Battery impact assessment

3. Documentation
   - User guide
   - Troubleshooting FAQ
   - API documentation updates

**Deliverables:**

- Published Mini Program in Zepp Store
- User documentation
- Support runbook

### Future Enhancements

- Workout data sync (GPS tracks, sport modes)
- Widget/complication for quick sync
- Push notifications for sync status
- Google Fit/Apple Health bridge (Option D)
- Multi-device support (T-Rex 3, Active 2, etc.)

---

## References

### Official Documentation

- [Zepp OS Developer Documentation](https://docs.zepp.com/)
- [Zepp OS Architecture Overview](https://docs.zepp.com/docs/guides/architecture/arc/)
- [Device List and API Levels](https://docs.zepp.com/docs/reference/related-resources/device-list/)
- [HeartRate Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/HeartRate/)
- [Sleep Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Sleep/)
- [Stress Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Stress/)
- [Bluetooth Communication Best Practices](https://docs.zepp.com/docs/guides/best-practice/bluetooth-communication/)
- [Side Service Fetch API](https://docs.zepp.com/docs/reference/side-service-api/fetch/)
- [App Submission Guide](https://docs.zepp.com/docs/distribute/)

### Community Resources

- [Zepp Health GitHub Discussions](https://github.com/orgs/zepp-health/discussions)
- [Post Health Data Sample](https://github.com/orgs/zepp-health/discussions/276)
- [awesome-zeppos Repository](https://github.com/zepp-health/awesome-zeppos)
- [ZML Library (npm)](https://www.npmjs.com/package/@zeppos/zml)

### Third-Party Integration References

- [Terra API Zepp Integration](https://tryterra.co/integrations/zepp)
- [ROOK Tech Zepp Documentation](https://docs.tryrook.io/data-sources/zepp/)

### IntexuraOS Internal Documentation

- [API Contracts](../architecture/api-contracts.md)
- [Service-to-Service Communication](../architecture/service-to-service-communication.md)
- [Firestore Ownership](../architecture/firestore-ownership.md)

---

## Appendix A: Zepp OS API Permissions

```json
{
  "permissions": [
    "data:user.hd.heart_rate",
    "data:user.hd.sleep",
    "data:user.hd.stress",
    "data:user.hd.spo2",
    "data:user.hd.calorie",
    "data:user.hd.step",
    "data:user.hd.distance",
    "data:user.hd.pai"
  ]
}
```

## Appendix B: Sample IntexuraOS Health Data Schema

```typescript
interface HealthDataSync {
  deviceType: 'amazfit_balance_2';
  syncedAt: string; // ISO 8601
  userId: string; // IntexuraOS user ID

  heartRate?: {
    last: number;
    resting?: number;
    dailyMax?: { value: number; timestamp: string };
    minuteByMinute?: number[]; // max 1440
  };

  sleep?: {
    score: number;
    deepTime: number; // minutes
    lightTime?: number; // minutes
    remTime?: number; // minutes
    totalTime: number; // minutes
    startTime: string; // ISO 8601
    endTime: string; // ISO 8601
    stages?: Array<{
      type: 'WAKE' | 'REM' | 'LIGHT' | 'DEEP';
      startMinute: number;
      endMinute: number;
    }>;
  };

  stress?: {
    current: number;
    timestamp: string;
    dailyAverage?: number;
  };

  bloodOxygen?: {
    value: number;
    timestamp: string;
  };

  activity?: {
    steps: number;
    calories: number;
    distance: number; // meters
    paiToday: number;
    paiWeekly: number;
  };
}
```

---

_Document prepared as part of INT-204 initial design phase._
