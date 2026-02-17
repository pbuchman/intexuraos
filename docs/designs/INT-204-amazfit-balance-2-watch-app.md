# Amazfit Balance 2 Watch App Design for IntexuraOS Data Sync

**Linear Issue:** [INT-204](https://linear.app/pbuchman/issue/INT-204/feature-design-amazfit-balance-2-watch-app-for-intexuraos-data-sync)
**Status:** Initial Design Phase
**Author:** Claude Opus 4.5
**Date:** 2026-01-22

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Device Overview](#device-overview)
3. [Development Platform Analysis](#development-platform-analysis)
4. [Available Health Data](#available-health-data)
5. [Architectural Options](#architectural-options)
6. [Complexity Analysis](#complexity-analysis)
7. [Security Considerations](#security-considerations)
8. [Recommendation](#recommendation)
9. [Implementation Roadmap](#implementation-roadmap)
10. [References](#references)

---

## Executive Summary

This document analyzes the design and implementation options for creating a native Amazfit Balance 2 watch application that syncs health and fitness data to IntexuraOS via API. The analysis prioritizes quality and thoroughness over simplicity, exploring multiple architectural approaches with their respective tradeoffs.

**Key Findings:**

- Amazfit Balance 2 runs **Zepp OS** with JavaScript-based Mini Program development
- Direct HTTP requests from the watch are **not supported** — all network communication must go through the companion phone app (Side Service)
- The platform provides comprehensive sensor APIs for health data access
- App distribution can be via the Zepp App Store or sideloading via Developer Mode

**Recommended Approach:** Option B (Side Service HTTP Relay) — provides the best balance of reliability, user experience, and implementation complexity while adhering to platform constraints.

---

## Device Overview

### Amazfit Balance 2 Specifications

| Category          | Specification                                |
| ----------------- | -------------------------------------------- |
| **Display**       | 47mm AMOLED touchscreen with sapphire glass  |
| **OS**            | Zepp OS (custom embedded Linux)              |
| **Processor**     | Not publicly disclosed (ARM-based)           |
| **Storage**       | 4GB built-in                                 |
| **Connectivity**  | Bluetooth 5.2 BLE, Wi-Fi 2.4GHz              |
| **GPS**           | Dual-Band (L1 + L5) with 6 satellite systems |
| **Water Rating**  | 45m dive certified                           |
| **Battery**       | Up to 21 days typical use                    |
| **Compatibility** | Android 7.0+, iOS 15.0+                      |
| **API Level**     | Zepp OS 4.2 (latest as of 2026)              |

### Sensor Array (BioTracker 6.0)

The Amazfit Balance 2 features Amazfit's latest BioTracker 6.0 PPG biometric sensor with an 8-point sensor array (8PD + 2LED):

| Sensor Type          | Capabilities                             |
| -------------------- | ---------------------------------------- |
| PPG Biometric        | Heart rate, HRV, SpO2, stress            |
| Accelerometer        | Movement, steps, activity detection      |
| Gyroscope            | Orientation, rotation, gesture detection |
| Geomagnetic          | Compass, navigation                      |
| Barometric Altimeter | Elevation, floors climbed                |
| Ambient Light        | Auto-brightness, sleep detection         |
| Skin Temperature     | Body temperature monitoring              |

---

## Development Platform Analysis

### Zepp OS Architecture

Zepp OS is a lightweight operating system designed for wearable devices. It supports development through **Mini Programs** — JavaScript-based applications that run on the watch.

```
┌─────────────────────────────────────────────────────────────────┐
│                        ZEPP OS ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐      ┌──────────────────────┐         │
│  │     WATCH DEVICE     │      │    SMARTPHONE APP    │         │
│  │    (Amazfit Balance) │      │      (Zepp App)      │         │
│  │                      │      │                      │         │
│  │  ┌────────────────┐  │      │  ┌────────────────┐  │         │
│  │  │   Device App   │  │ BLE  │  │  Side Service  │  │         │
│  │  │  (JavaScript)  │◄─┼──────┼─►│  (JavaScript)  │  │         │
│  │  └────────────────┘  │      │  └───────┬────────┘  │         │
│  │          │           │      │          │           │         │
│  │          ▼           │      │          ▼           │         │
│  │  ┌────────────────┐  │      │  ┌────────────────┐  │         │
│  │  │  Sensor APIs   │  │      │  │   fetch() API  │  │  HTTP   │
│  │  │ (Health Data)  │  │      │  │  (Network I/O) │──┼────────►│
│  │  └────────────────┘  │      │  └────────────────┘  │         │
│  │                      │      │                      │         │
│  │  ┌────────────────┐  │      │  ┌────────────────┐  │         │
│  │  │  Settings App  │◄─┼──────┼─►│  Settings App  │  │         │
│  │  │  (Watch UI)    │  │      │  │  (Phone UI)    │  │         │
│  │  └────────────────┘  │      │  └────────────────┘  │         │
│  │                      │      │                      │         │
│  └──────────────────────┘      └──────────────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Mini Program Components

A complete Zepp OS Mini Program consists of three parts:

| Component        | Location     | Purpose                                 | Network Access |
| ---------------- | ------------ | --------------------------------------- | -------------- |
| **Device App**   | Watch        | UI rendering, sensor access, user input | No (BLE only)  |
| **Side Service** | Phone (Zepp) | Network requests, background processing | Yes (fetch)    |
| **Settings App** | Phone (Zepp) | Configuration UI, user preferences      | Yes (fetch)    |

**Critical Constraint:** The Device App running on the watch **cannot make HTTP requests directly**. All network communication must be relayed through the Side Service running on the companion smartphone.

### Development Tools

| Tool               | Purpose                                     |
| ------------------ | ------------------------------------------- |
| **Zeus CLI**       | Project scaffolding, building, deployment   |
| **Zepp Console**   | App registration, management, analytics     |
| **Developer Mode** | Sideloading via QR code scanning            |
| **Simulator**      | Desktop testing (limited sensor simulation) |

### Communication Protocol

Watch-to-phone communication uses Bluetooth Low Energy (BLE) with the **MessageBuilder** library abstracting the complexity:

```javascript
// Device App (Watch) - Sending data to Side Service
import { MessageBuilder } from '../shared/message.js';

const messageBuilder = new MessageBuilder({ appId: APP_ID });

// Send health data to phone
messageBuilder.request({
  method: 'SYNC_HEALTH_DATA',
  params: {
    heartRate: hrData,
    sleep: sleepData,
    stress: stressData,
  },
});
```

```javascript
// Side Service (Phone) - Receiving and forwarding to API
import { MessageBuilder } from '../shared/message-side.js';

messageBuilder.on('request', (ctx) => {
  if (ctx.request.method === 'SYNC_HEALTH_DATA') {
    // Forward to IntexuraOS API
    fetch('https://api.intexuraos.com/v1/health/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(ctx.request.params),
    });
  }
});
```

### App Distribution Options

| Method             | Requirements                     | Use Case                     |
| ------------------ | -------------------------------- | ---------------------------- |
| **Zepp App Store** | Review approval, privacy policy  | Public distribution          |
| **Developer Mode** | QR code scanning, manual install | Testing, private use         |
| **Enterprise**     | Contact Zepp for arrangements    | Organization-wide deployment |

---

## Available Health Data

### Sensor APIs and Data Access

The Zepp OS SDK provides comprehensive APIs for accessing health and fitness data:

#### Heart Rate (`@zos/sensor` HeartRate)

| Method              | Returns                            | Granularity       |
| ------------------- | ---------------------------------- | ----------------- |
| `getCurrent()`      | Current HR value (in callback)     | Real-time         |
| `getLast()`         | Most recent HR measurement         | Single value      |
| `getToday()`        | HR data from 00:00 to now          | Per-minute (1440) |
| `getResting()`      | Resting heart rate                 | Daily average     |
| `onCurrentChange()` | Callback for continuous monitoring | Real-time stream  |

#### Sleep (`@zos/sensor` Sleep)

| Method                | Returns                            | Data Points       |
| --------------------- | ---------------------------------- | ----------------- |
| `getBasicInfo()`      | Score, deep sleep, start/end times | Per sleep session |
| `getTotalTime()`      | Total sleep duration               | Minutes           |
| `getSleepStageData()` | Detailed sleep stage breakdown     | Per-stage         |
| `getHeartRate()`      | HR during sleep (per-minute array) | Per-minute        |

#### Stress (`@zos/sensor` Stress)

| Method                | Returns                            | Granularity      |
| --------------------- | ---------------------------------- | ---------------- |
| `getCurrent()`        | Current stress value + timestamp   | Real-time        |
| `getToday()`          | Stress data for today (per-minute) | 1440 max entries |
| `getTodayByHour()`    | Hourly averages for today          | 24 entries       |
| `getLastWeek()`       | Daily averages for past 7 days     | 7 entries        |
| `getLastWeekByHour()` | Hourly data for past 7 days        | 168 entries      |

#### Blood Oxygen (`@zos/sensor` BloodOxygen)

| Method         | Returns                      | Notes              |
| -------------- | ---------------------------- | ------------------ |
| `getCurrent()` | Current SpO2 value           | Requires `start()` |
| `getLast()`    | Most recent SpO2 measurement | Single value       |
| `start()`      | Begin SpO2 measurement       | User-initiated     |
| `stop()`       | Stop measurement             | Cleanup            |

#### Activity & Fitness

| Sensor       | Key Methods                                 | Data Types                     |
| ------------ | ------------------------------------------- | ------------------------------ |
| **Calorie**  | `getCurrent()`, `getTarget()`, `onChange()` | Daily calories burned          |
| **Step**     | `getCurrent()`, `getTarget()`, `onChange()` | Daily step count               |
| **Distance** | `getCurrent()`                              | Daily distance (meters)        |
| **PAI**      | `getToday()`, `getTotal()`, `getLastWeek()` | Personal Activity Intelligence |
| **Workout**  | `getStatus()`, Navigation info (API 3.6+)   | Active workout data            |

#### Additional Sensors

| Sensor          | Data Available               | API Level |
| --------------- | ---------------------------- | --------- |
| **BodyTemp**    | Current body temperature     | 3.0+      |
| **Weather**     | Current conditions, forecast | 2.0+      |
| **Geolocation** | GPS coordinates, altitude    | 2.0+      |
| **Barometer**   | Air pressure, altitude       | 2.0+      |
| **Compass**     | Heading direction            | 2.0+      |

### Data Permissions

Each sensor requires explicit permission declaration in `app.json`:

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
    "data:user.hd.pai",
    "data:user.hd.workout"
  ]
}
```

---

## Architectural Options

### Option A: Watch-Only with Periodic Sync

```
┌─────────────────────────────────────────────────────────────────┐
│                     OPTION A: WATCH-ONLY                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                        ┌──────────────────┐   │
│  │    WATCH     │                        │   INTEXURAOS     │   │
│  │              │                        │                  │   │
│  │ ┌──────────┐ │     BLE + Phone        │                  │   │
│  │ │Device App│ │◄────(automatic)────────│                  │   │
│  │ │          │ │                        │                  │   │
│  │ │ Collect  │ │                        │                  │   │
│  │ │  & Queue │ │                        │                  │   │
│  │ └────┬─────┘ │                        │                  │   │
│  │      │       │                        │                  │   │
│  │      ▼       │                        │                  │   │
│  │ ┌──────────┐ │                        │  ┌────────────┐  │   │
│  │ │  Local   │ │     Zepp Cloud Sync    │  │  Zepp API  │  │   │
│  │ │ Storage  │ ├────────────────────────┼─►│  Polling   │  │   │
│  │ └──────────┘ │     (if available)     │  └─────┬──────┘  │   │
│  │              │                        │        │         │   │
│  └──────────────┘                        │        ▼         │   │
│                                          │  ┌────────────┐  │   │
│                                          │  │ Health API │  │   │
│                                          │  └────────────┘  │   │
│                                          │                  │   │
│                                          └──────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Description:** Collect data on watch, store locally, rely on Zepp's cloud sync, then poll Zepp's API from IntexuraOS.

| Aspect           | Assessment                                              |
| ---------------- | ------------------------------------------------------- |
| **Complexity**   | Low (watch app simple)                                  |
| **Reliability**  | Low (depends on Zepp cloud availability and API access) |
| **Latency**      | High (cloud sync delays + polling intervals)            |
| **Data Control** | Low (data passes through Zepp's servers)                |
| **Privacy**      | Moderate concern (third-party data handling)            |

**Verdict:** Not recommended. Relies on undocumented/unofficial Zepp cloud APIs that may change or be restricted.

---

### Option B: Side Service HTTP Relay (Recommended)

```
┌─────────────────────────────────────────────────────────────────┐
│                 OPTION B: SIDE SERVICE RELAY                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐   │
│  │    WATCH     │      │   ZEPP APP   │      │  INTEXURAOS  │   │
│  │              │      │   (Phone)    │      │              │   │
│  │ ┌──────────┐ │      │ ┌──────────┐ │      │              │   │
│  │ │Device App│ │ BLE  │ │   Side   │ │ HTTP │ ┌──────────┐ │   │
│  │ │          │◄├──────┼►│ Service  │◄├──────┼►│Health API│ │   │
│  │ │ Sensors  │ │      │ │          │ │      │ │          │ │   │
│  │ │ + UI     │ │      │ │ Auth +   │ │      │ │ Ingest + │ │   │
│  │ └──────────┘ │      │ │ Relay    │ │      │ │ Process  │ │   │
│  │              │      │ └──────────┘ │      │ └──────────┘ │   │
│  │ ┌──────────┐ │      │              │      │              │   │
│  │ │Settings  │◄├──────┼──────────────┤      │              │   │
│  │ │  App     │ │      │ ┌──────────┐ │      │              │   │
│  │ └──────────┘ │      │ │Settings  │ │      │              │   │
│  │              │      │ │  App     │ │      │              │   │
│  └──────────────┘      │ │(Auth UI) │ │      │              │   │
│                        │ └──────────┘ │      │              │   │
│                        │              │      │              │   │
│                        └──────────────┘      └──────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Description:** Device App collects sensor data, sends via BLE to Side Service on phone, which makes HTTP requests to IntexuraOS API.

| Aspect           | Assessment                                           |
| ---------------- | ---------------------------------------------------- |
| **Complexity**   | Medium (full Mini Program with all 3 components)     |
| **Reliability**  | High (direct HTTP to own infrastructure)             |
| **Latency**      | Low-Medium (BLE hop + HTTP, near real-time possible) |
| **Data Control** | High (direct control of data pipeline)               |
| **Privacy**      | High (data flows directly to own servers)            |

**Verdict:** Recommended. Follows Zepp OS best practices, provides full control, and enables real-time sync.

---

### Option C: Hybrid with Local Buffering

```
┌─────────────────────────────────────────────────────────────────┐
│                  OPTION C: HYBRID BUFFERED                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐   │
│  │    WATCH     │      │   ZEPP APP   │      │  INTEXURAOS  │   │
│  │              │      │   (Phone)    │      │              │   │
│  │ ┌──────────┐ │      │ ┌──────────┐ │      │              │   │
│  │ │Device App│ │      │ │   Side   │ │      │ ┌──────────┐ │   │
│  │ │          │ │ BLE  │ │ Service  │ │ HTTP │ │Health API│ │   │
│  │ │ Sensors  │◄├──────┼►│          │◄├──────┼►│          │ │   │
│  │ │ + UI     │ │      │ │ Auth +   │ │      │ │ Ingest + │ │   │
│  │ └────┬─────┘ │      │ │ Relay    │ │      │ │ Process  │ │   │
│  │      │       │      │ └────┬─────┘ │      │ └──────────┘ │   │
│  │      ▼       │      │      │       │      │              │   │
│  │ ┌──────────┐ │      │      ▼       │      │              │   │
│  │ │  Local   │ │      │ ┌──────────┐ │      │              │   │
│  │ │  Buffer  │ │      │ │  Local   │ │      │              │   │
│  │ │ (Offline)│ │      │ │  Queue   │ │      │              │   │
│  │ └──────────┘ │      │ │(Offline) │ │      │              │   │
│  │              │      │ └──────────┘ │      │              │   │
│  └──────────────┘      │              │      │              │   │
│                        └──────────────┘      └──────────────┘   │
│                                                                  │
│  Sync when: BLE connected + Network available                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Description:** Same as Option B, but with offline buffering on both watch and phone for resilience.

| Aspect           | Assessment                                                 |
| ---------------- | ---------------------------------------------------------- |
| **Complexity**   | High (buffer management, conflict resolution, retry logic) |
| **Reliability**  | Very High (handles offline scenarios gracefully)           |
| **Latency**      | Variable (immediate when online, deferred when offline)    |
| **Data Control** | High (direct control)                                      |
| **Privacy**      | High (direct data flow)                                    |

**Verdict:** Best for production-grade reliability. Recommended as evolution of Option B after MVP.

---

### Option D: Background Sync via Workout Extension

```
┌─────────────────────────────────────────────────────────────────┐
│               OPTION D: WORKOUT EXTENSION                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────┐                       │
│  │              WATCH                    │                       │
│  │                                       │                       │
│  │  ┌─────────────────────────────────┐  │                       │
│  │  │      Native Workout App         │  │                       │
│  │  │  (System-provided workout UI)   │  │                       │
│  │  └───────────────┬─────────────────┘  │                       │
│  │                  │                    │                       │
│  │                  ▼                    │                       │
│  │  ┌─────────────────────────────────┐  │                       │
│  │  │     Workout Extension           │  │                       │
│  │  │  (Custom Mini Program)          │  │      Same as         │
│  │  │                                 │  │      Option B         │
│  │  │  - Real-time workout data       │◄─┼──────────────────────►│
│  │  │  - Additional metrics display   │  │                       │
│  │  │  - Background data collection   │  │                       │
│  │  └─────────────────────────────────┘  │                       │
│  │                                       │                       │
│  └──────────────────────────────────────┘                       │
│                                                                  │
│  Requirement: API Level 3.6+                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Description:** Use Zepp OS Workout Extension API to integrate with native workout tracking for real-time exercise data sync.

| Aspect           | Assessment                                         |
| ---------------- | -------------------------------------------------- |
| **Complexity**   | Medium-High (specialized API, limited to workouts) |
| **Reliability**  | High (leverages native workout infrastructure)     |
| **Latency**      | Very Low (real-time during workouts)               |
| **Data Control** | Medium (constrained to workout context)            |
| **Privacy**      | High (direct data flow)                            |

**Verdict:** Complementary option for workout-specific scenarios. Should be combined with Option B/C for complete coverage.

---

## Complexity Analysis

### Development Effort Comparison

| Option   | Watch Dev | Phone Dev | Backend Dev | Total Effort | Risk Level |
| -------- | --------- | --------- | ----------- | ------------ | ---------- |
| Option A | Low       | None      | Medium      | **Low**      | High       |
| Option B | Medium    | Medium    | Medium      | **Medium**   | Low        |
| Option C | High      | High      | Medium      | **High**     | Low        |
| Option D | Medium    | Medium    | Medium      | **Medium**   | Medium     |

### Technical Challenges by Option

#### Option A Challenges

- Undocumented Zepp Cloud API (may break without notice)
- No official support for third-party API access
- Rate limiting and access restrictions unknown
- Data format may change without warning

#### Option B Challenges

- BLE message size limitations (~4KB per message)
- MessageBuilder learning curve
- Phone app must be running for sync
- Battery impact from frequent BLE communication

#### Option C Challenges (in addition to B)

- Buffer overflow management
- Conflict resolution for delayed syncs
- Storage limitations on watch (4GB shared)
- Complex state management across devices

#### Option D Challenges

- Only works during active workouts
- API Level 3.6+ requirement
- Limited to SPORT_DATA widget types
- Cannot access full sensor range

### Zepp OS Specific Constraints

| Constraint                | Impact                                    | Mitigation                      |
| ------------------------- | ----------------------------------------- | ------------------------------- |
| No direct HTTP from watch | Must use Side Service for all network I/O | Accept as platform design       |
| BLE message fragmentation | Large payloads need chunking              | Use MessageBuilder's built-in   |
| Phone dependency          | Sync fails if phone unavailable           | Local buffering (Option C)      |
| Permission model          | Each sensor requires explicit permission  | Clear UX explaining permissions |
| App Store review          | May reject apps with certain data usage   | Thorough privacy policy         |

---

## Security Considerations

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   AUTHENTICATION FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐     ┌──────────────┐     ┌──────────────────┐     │
│  │  WATCH   │     │  PHONE APP   │     │   INTEXURAOS     │     │
│  │          │     │              │     │                  │     │
│  │ 1. User  │     │              │     │                  │     │
│  │ opens app│     │              │     │                  │     │
│  │    │     │     │              │     │                  │     │
│  │    ▼     │     │              │     │                  │     │
│  │ 2. Check │     │              │     │                  │     │
│  │ auth state────►│ 3. If no    │     │                  │     │
│  │          │     │ token, open │     │                  │     │
│  │          │     │ Settings App│     │                  │     │
│  │          │     │    │        │     │                  │     │
│  │          │     │    ▼        │     │                  │     │
│  │          │     │ 4. OAuth2   │     │                  │     │
│  │          │     │ PKCE flow ──┼────►│ 5. Auth endpoint │     │
│  │          │     │            │◄────┼── 6. Tokens       │     │
│  │          │     │    │        │     │                  │     │
│  │          │     │    ▼        │     │                  │     │
│  │          │◄────┼─ 7. Store   │     │                  │     │
│  │ 8. Confirm│     │ tokens in  │     │                  │     │
│  │ auth state│     │ SecureStore│     │                  │     │
│  │          │     │              │     │                  │     │
│  └──────────┘     └──────────────┘     └──────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Security Requirements

| Requirement            | Implementation                                         |
| ---------------------- | ------------------------------------------------------ |
| **Token Storage**      | Use Zepp's SecureStorage API, never plain localStorage |
| **Transport Security** | HTTPS only, certificate pinning recommended            |
| **Token Refresh**      | Implement refresh token flow, handle expiry gracefully |
| **Scope Limitation**   | Request minimal API scopes needed                      |
| **Data Minimization**  | Only sync data actively configured by user             |
| **Audit Logging**      | Log sync events for debugging (not sensitive data)     |

### Privacy Considerations

| Data Type          | Sensitivity | Handling                                        |
| ------------------ | ----------- | ----------------------------------------------- |
| Heart Rate         | High        | Encrypt at rest, user consent required          |
| Sleep Data         | High        | Aggregate when possible, clear retention policy |
| Location/GPS       | High        | Explicit opt-in, don't store raw coordinates    |
| Activity Data      | Medium      | Standard protection, user-visible controls      |
| Device Identifiers | Medium      | Hash before transmission, rotate periodically   |

---

## Recommendation

### Primary Recommendation: Option B (Side Service HTTP Relay)

**Rationale:**

1. **Platform Alignment:** Follows Zepp OS's intended architecture for network communication
2. **Control:** Direct API integration without third-party dependencies
3. **Privacy:** Data flows directly to IntexuraOS without intermediaries
4. **Reliability:** Well-documented APIs with predictable behavior
5. **Scalability:** Can evolve to Option C (buffering) without architectural changes

### Evolution Path

```
Phase 1 (MVP)           Phase 2 (Production)       Phase 3 (Advanced)
─────────────────────────────────────────────────────────────────────
Option B                Option C                   Option C + D
Side Service Relay  →   + Offline Buffering    →   + Workout Extension
                        + Retry Logic              + Real-time Workouts
                        + Conflict Resolution      + Background Sync
```

### Recommended Data Sync Strategy

| Data Type  | Sync Frequency    | Trigger                    |
| ---------- | ----------------- | -------------------------- |
| Heart Rate | Every 5 minutes   | Timer + significant change |
| Sleep      | On wake detection | Sleep session complete     |
| Stress     | Every 15 minutes  | Timer + high stress event  |
| Activity   | Every 30 minutes  | Timer + workout complete   |
| SpO2       | On measurement    | User-initiated measurement |

---

## Implementation Roadmap

### Phase 1: Foundation (2-3 weeks)

| Task                                   | Deliverable                          |
| -------------------------------------- | ------------------------------------ |
| Set up Zepp OS development environment | Zeus CLI, console registration       |
| Create Mini Program scaffold           | Device App + Side Service + Settings |
| Implement basic sensor reading         | Heart rate, steps proof of concept   |
| BLE communication setup                | MessageBuilder integration           |
| IntexuraOS health API design           | OpenAPI spec for `/health/sync`      |

### Phase 2: Core Features (3-4 weeks)

| Task                     | Deliverable                         |
| ------------------------ | ----------------------------------- |
| Full sensor integration  | All health metrics from sensor APIs |
| Authentication flow      | OAuth2 PKCE via Settings App        |
| Data sync implementation | Side Service HTTP to IntexuraOS     |
| Watch UI for sync status | Visual feedback on Device App       |
| Error handling & retry   | Robust failure recovery             |

### Phase 3: Polish & Distribution (2-3 weeks)

| Task                         | Deliverable                 |
| ---------------------------- | --------------------------- |
| User preferences UI          | Configurable sync options   |
| Privacy policy & permissions | App Store compliance        |
| Testing on physical device   | Real-world validation       |
| App Store submission         | Published Mini Program      |
| Documentation                | User guide, troubleshooting |

### Phase 4: Production Hardening (Future)

| Task                         | Deliverable                     |
| ---------------------------- | ------------------------------- |
| Offline buffering (Option C) | Resilient sync with local queue |
| Workout Extension (Option D) | Real-time workout data          |
| Battery optimization         | Efficient sync scheduling       |
| Analytics & monitoring       | Usage metrics, error tracking   |

---

## References

### Official Documentation

- [Zepp OS Developer Documentation](https://docs.zepp.com/)
- [HeartRate Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/HeartRate/)
- [Sleep Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Sleep/)
- [Stress Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Stress/)
- [BloodOxygen Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/BloodOxygen/)
- [PAI Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Pai/)
- [Calorie Sensor API](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Calorie/)
- [Workout Extension Guide](https://docs.zepp.com/docs/guides/workout-extension/intro/)
- [App Submission Guide](https://docs.zepp.com/docs/distribute/)
- [Zepp App Developer Mode](https://docs.zepp.com/docs/guides/tools/zepp-app/)

### Device Information

- [Amazfit Balance 2 Product Page](https://us.amazfit.com/products/balance-2)
- [Amazfit Balance 2 Review - Tom's Guide](https://www.tomsguide.com/wellness/smartwatches/i-just-went-hands-on-with-the-amazfit-balance-2-this-premium-multisport-smartwatch-boasts-21-days-of-battery-life)
- [Amazfit Balance 2 Review - The 5K Runner](https://the5krunner.com/2025/12/05/amazfit-balance-2-review/)

### Community Resources

- [Zepp Health GitHub Discussions](https://github.com/orgs/zepp-health/discussions/276)
- [Zepp OS Samples Repository](https://github.com/zepp-health/zeppos-samples)
- [Awesome Zepp OS](https://github.com/zepp-health/awesome-zeppos)

---

## Appendix A: Sample Code Structure

```
amazfit-intexuraos-sync/
├── app.json                    # App manifest with permissions
├── app.js                      # App lifecycle
├── page/
│   ├── index/                  # Main watch UI
│   │   ├── index.page.js
│   │   └── index.style.js
│   └── settings/               # Watch settings page
│       └── settings.page.js
├── setting/
│   └── index.js                # Phone Settings App (auth UI)
├── shared/
│   ├── message.js              # MessageBuilder for Device App
│   └── message-side.js         # MessageBuilder for Side Service
├── secondary-widget/           # Optional quick glance widget
│   └── index.js
└── side-service/
    └── index.js                # Network requests to IntexuraOS
```

## Appendix B: IntexuraOS Health API Contract (Draft)

```yaml
openapi: 3.0.3
info:
  title: IntexuraOS Health Sync API
  version: 1.0.0
  description: API for receiving health data from wearable devices

paths:
  /v1/health/sync:
    post:
      summary: Sync health data from wearable device
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/HealthSyncPayload'
      responses:
        '200':
          description: Data synced successfully
        '401':
          description: Unauthorized
        '422':
          description: Validation error

components:
  schemas:
    HealthSyncPayload:
      type: object
      required:
        - deviceId
        - timestamp
      properties:
        deviceId:
          type: string
          description: Hashed device identifier
        timestamp:
          type: string
          format: date-time
        heartRate:
          $ref: '#/components/schemas/HeartRateData'
        sleep:
          $ref: '#/components/schemas/SleepData'
        stress:
          $ref: '#/components/schemas/StressData'
        activity:
          $ref: '#/components/schemas/ActivityData'
        bloodOxygen:
          $ref: '#/components/schemas/BloodOxygenData'

    HeartRateData:
      type: object
      properties:
        current:
          type: integer
        resting:
          type: integer
        samples:
          type: array
          items:
            type: object
            properties:
              timestamp:
                type: string
                format: date-time
              value:
                type: integer

    SleepData:
      type: object
      properties:
        score:
          type: integer
        totalMinutes:
          type: integer
        deepMinutes:
          type: integer
        lightMinutes:
          type: integer
        remMinutes:
          type: integer
        awakeMinutes:
          type: integer
        startTime:
          type: string
          format: date-time
        endTime:
          type: string
          format: date-time

    StressData:
      type: object
      properties:
        current:
          type: integer
        average:
          type: integer
        samples:
          type: array
          items:
            type: object
            properties:
              timestamp:
                type: string
                format: date-time
              value:
                type: integer

    ActivityData:
      type: object
      properties:
        steps:
          type: integer
        calories:
          type: integer
        distance:
          type: integer
          description: Distance in meters
        pai:
          type: integer

    BloodOxygenData:
      type: object
      properties:
        value:
          type: integer
        timestamp:
          type: string
          format: date-time

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```
