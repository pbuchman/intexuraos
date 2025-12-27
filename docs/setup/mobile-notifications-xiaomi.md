# Tasker & AutoNotification Setup Documentation

**Device:** Redmi Note 13 Pro 5G  
**OS:** HyperOS (Android 14)  
**Goal:** Intercept notifications from specific apps and send them via HTTP POST to IntexuraOS.

---

## 1. System Configuration (HyperOS Optimization)

Xiaomi's HyperOS requires manual intervention to prevent the system from killing background processes.

### 1.1. Autostart & Permissions

1. Navigate to **Settings** → **Apps** → **Permissions** → **Background autostart**.
2. Enable the toggle for both **Tasker** and **AutoNotification**.
3. Inside the **Background autostart** menu, click on the app names and ensure **Background autostart** is enabled to allow the apps to trigger even when the screen is off.

### 1.2. Battery Optimization

1. Go to **Settings** → **Apps** → **Manage apps**.
2. Locate **Tasker**, go to **Battery saver**, and select **No restrictions**.
3. Repeat this for **AutoNotification**.

### 1.3. Notification Access

1. Go to **Settings** → **Privacy** → **Special permissions** → **Notification access**.
2. Ensure **AutoNotification** is set to **Allowed**. This is required to read the actual content (title/text) of incoming notifications.

---

## 2. AutoNotification Intercept Configuration

This profile acts as the trigger for the automation.

1. **Create Profile:** Open Tasker → **Profiles** → **+** → **Event** → **Plugin** → **AutoNotification** → **Intercept**.
2. **Configuration:**
   - **Action Type:** Set to `Created`.
   - **Apps:** Select your desired apps (e.g., `Zen`, `Revolut`).
   - **Event Behaviour:** Enabled (True).
3. **Variables:** The plugin automatically populates local variables such as `%antitle`, `%antext`, and `%anpackage` upon interception.

---

## 3. Tasker Task: HTTP POST Request

This task executes the data transmission to the backend.

### 3.1. Action Setup

1. **Action:** `Net` → `HTTP Request`.
2. **Method:** `POST`.
3. **URL:** `https://YOUR_SERVICE_URL/v1/webhooks/mobile-notifications`
4. **Headers:**
   - `Content-Type: application/json`
   - `X-Mobile-Notifications-Signature: YOUR_SIGNATURE`

### 3.2. JSON Payload (Body)

To ensure data integrity and deduplication, use the following structure:

```json
{
  "source": "tasker",
  "device": "redmi-note-13-pro",
  "timestamp": %TIMES,
  "notification_id": "%ankey",
  "post_time": "%anposttime",
  "app": "%anpackage",
  "title": "%antitle",
  "text": "%antext"
}
```

**Variables:**

- `%ankey`: Provides a unique system key (e.g., `0|com.revolut.revolut|101...`) used for deduplication on the backend.
- `%anposttime`: The exact millisecond the notification was posted.
- `%TIMES`: Current Unix timestamp.

**Content Type:** Set to `application/json`.

---

## 4. Debugging & System Behavior

### 4.1. "No active profiles" Status

In the notification shade, Tasker may show "No active profiles".

**Meaning:** This is normal for Event-based profiles. An event (like a notification) only triggers the profile for a fraction of a second. It does not stay "Active" like a State-based profile (e.g., "WiFi Connected").

### 4.2. Understanding Log Errors

Based on the device logs:

- **Response Code 401:** The request reached the server, but the server rejected it due to a lack of authentication. Check your signature.
- **%http_response_content:** If this variable appears as raw text in your logs, it means the server returned an empty body (typical for 401 errors).
- **Variable Names:** Ensure variables are written in lowercase (e.g., `%antitle`). Uppercase variables are treated as global and may remain empty if not defined globally.

### 4.3. Persistence

To ensure the service remains alive on HyperOS:

1. Open the Recent Apps view.
2. Long-press the Tasker card and click the **Lock icon**.
3. Always click the **Checkmark (V)** in the top right of the Tasker main screen after making any changes to save and apply the configuration.

---

## 5. Getting Your Signature

1. Log in to IntexuraOS web app
2. Navigate to **Mobile Setup** in the sidebar
3. Click **Generate Signature**
4. Copy the signature and paste it into your Tasker HTTP Request header

**Important:** The signature is only shown once. If you lose it, you'll need to regenerate a new one.

---

## 6. Troubleshooting

| Issue                            | Solution                                                       |
| -------------------------------- | -------------------------------------------------------------- |
| Notifications not being captured | Check AutoNotification has Notification Access permission      |
| 401 Unauthorized errors          | Verify your signature is correct and hasn't been regenerated   |
| Tasker killed in background      | Enable autostart and disable battery optimization              |
| Variables empty in payload       | Use lowercase variable names (e.g., `%antitle` not `%ANTITLE`) |
