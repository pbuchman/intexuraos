# Notion DB Reverse Engineering: Inbox Notes & Inbox Actions (API Guide)

## 1. Located Databases

- Parent page: [PraxOS – Notes & Actions Hub](https://www.notion.so/PraxOS-Notes-Actions-Hub-0b80a2d5448c4d2e8998c3ae265cfb12?pvs=21) ("PraxOS – Notes & Actions Hub")
- Inbox Notes (name + database ID): "View of Inbox" — [](https://www.notion.so/63256a187ac44648aa05e10efedcc7e8?pvs=21)
    - Data source (schema ID): [Inbox](https://www.notion.so/33132459790b81389db0000392254de6/ds/fd13e74a1128495fae248a70acf30f62?db=08a02c6880344364ae86e63688660fbd&pvs=21) ("📥 Inbox")
- Inbox Actions (name + database ID): "View of Actions" — [](https://www.notion.so/1c220ddedf7a466994395d9290525a53?pvs=21)
    - Data source (schema ID): [Actions](https://www.notion.so/33132459790b81389db0000392254de6/ds/843b715aa5dd4672afc5123ba075b2c3?db=82d9b2f78f9c44f49cb9db9846e76c57&pvs=21) ("✅ Actions")

## 2. Inbox Notes — Schema

### 2.1 Metadata and Views

- Data source name: "📥 Inbox" ([Inbox](https://www.notion.so/33132459790b81389db0000392254de6/ds/fd13e74a1128495fae248a70acf30f62?db=08a02c6880344364ae86e63688660fbd&pvs=21))
- Database (view container) name: "View of Inbox" ([](https://www.notion.so/63256a187ac44648aa05e10efedcc7e8?pvs=21))
- Inline or full-page DB: inline (embedded on parent page)
- Primary property:
    - **Title** (type: Title)
- Views observed
    - Table view (name is empty in config)
        - Type: table
        - Displayed properties: Title, Actions, Captured at, Clean text, Errors, External ID, Media, Message type, Original text, Processed by, Processing run id, Sender, Source, Status, Topic, Transcript, Type, URL
        - Filters/sorts: not configured in view payload (unknown)

### 2.2 Properties Table

| Property name (exact) | Type | Required? | Constraints / options (exact) | Example value (redacted) |
| --- | --- | --- | --- | --- |
| Title | Title | unknown | Primary title of the inbox item. | "WA: quick note — …" |
| Status | Select | unknown | Inbox, Processing, Processed, Archived, DeletedCandidate | Inbox |
| Source | Select | unknown | WhatsApp, Manual, WebClipper, Email, API, Automation | WhatsApp |
| Message type | Select | unknown | Text, Image, Video, Audio, Document, Mixed | Audio |
| Type | Select | unknown | Web, Prompt, Meeting, Idea, Task, Log, Quote, Research, Other | Idea |
| Topic | Multi-select | unknown | AI, Work, Health, Fishing, PraxOS, Home, Family | ["PraxOS","AI"] |
| Original text | Rich text | unknown | Free text. | "Raw WhatsApp message…" |
| Clean text | Rich text | unknown | Free text. | "Normalized message…" |
| Transcript | Rich text | unknown | Free text. | "Transcription…" |
| Media | Files & media | unknown | 0..n files | [file] |
| Captured at | Date | unknown | Date (can be datetime). | 2025-12-20 12:00 |
| Sender | Rich text | unknown | Free text. | "+48…" / "Piotr" |
| External ID | Rich text | unknown | Free text (idempotency / external message id). | "wamid.…" |
| Processing run id | Rich text | unknown | Free text. | "run_…" |
| Processed by | Select | unknown | MasterNotesAssistant, None, Manual | None |
| Errors | Rich text | unknown | Free text. | "…" |
| Actions | Relation | optional | Relation to ✅ Actions ([Actions](https://www.notion.so/33132459790b81389db0000392254de6/ds/843b715aa5dd4672afc5123ba075b2c3?db=82d9b2f78f9c44f49cb9db9846e76c57&pvs=21)). 0..n links. | [action page url] |
| URL | URL | unknown | Property is internally represented as userDefined:URL (see API payload notes below). | [https://example.com](https://example.com) |

### 2.3 Relations / Rollups / Formulas

- Relation to Inbox Actions exists.
    - On Inbox Notes: **Actions** → related data source ✅ Actions ([Actions](https://www.notion.so/33132459790b81389db0000392254de6/ds/843b715aa5dd4672afc5123ba075b2c3?db=82d9b2f78f9c44f49cb9db9846e76c57&pvs=21))
    - On Inbox Actions: **Source note** → related data source 📥 Inbox ([Inbox](https://www.notion.so/33132459790b81389db0000392254de6/ds/fd13e74a1128495fae248a70acf30f62?db=08a02c6880344364ae86e63688660fbd&pvs=21))
- Rollups: none observed in schema.
- Formulas: none observed in schema.

## 3. Inbox Actions — Schema

### 3.1 Metadata and Views

- Data source name: "✅ Actions" ([Actions](https://www.notion.so/33132459790b81389db0000392254de6/ds/843b715aa5dd4672afc5123ba075b2c3?db=82d9b2f78f9c44f49cb9db9846e76c57&pvs=21))
- Database (view container) name: "View of Actions" ([](https://www.notion.so/1c220ddedf7a466994395d9290525a53?pvs=21))
- Inline or full-page DB: inline (embedded on parent page)
- Primary property:
    - **Title** (type: Title)
- Views observed
    - Table view (name is empty in config)
        - Type: table
        - Displayed properties: Title, Action type, Agent, Approval token, Due date, Execution log, External correlation id, Payload (JSON), Priority, Source note, Status, User WA, User notify
        - Filters/sorts: not configured in view payload (unknown)

### 3.2 Properties Table

| Property name (exact) | Type | Required? | Constraints / options (exact) | Example value (redacted) |
| --- | --- | --- | --- | --- |
| Title | Title | unknown | Name of the action. | "Create task: …" |
| Status | Select | unknown | Proposed, Needs approval, Approved, Rejected, Executing, Done, Failed | Proposed |
| Action type | Select | unknown | Create, Update, Move, Delete, Notify, Enrich | Create |
| Agent | Select | unknown | TodoAgent, KnowledgeAgent, CalendarAgent, PromptAgent, FinanceAgent | TodoAgent |
| Priority | Select | unknown | Low, Medium, High, Urgent | Medium |
| Due date | Date | unknown | Date (can be datetime). | 2025-12-27 |
| Source note | Relation | optional | Relation to 📥 Inbox ([Inbox](https://www.notion.so/33132459790b81389db0000392254de6/ds/fd13e74a1128495fae248a70acf30f62?db=08a02c6880344364ae86e63688660fbd&pvs=21)). Typically 0..1 (limit unknown). | [note page url] |
| Payload (JSON) | Rich text | unknown | Free text (expected JSON string). | "{…}" |
| Execution log | Rich text | unknown | Free text. | "Executed at …" |
| Approval token | Rich text | unknown | Free text. | "token_…" |
| External correlation id | Rich text | unknown | Free text. | "wamid.…" / "corr_…" |
| User WA | Rich text | unknown | Free text (WhatsApp user identifier / phone). | "+48…" |
| User notify | Checkbox | unknown | true/false | false |

### 3.3 Relations / Rollups / Formulas

- Relation to Inbox Notes exists.
    - On Inbox Actions: **Source note** → related data source 📥 Inbox ([Inbox](https://www.notion.so/33132459790b81389db0000392254de6/ds/fd13e74a1128495fae248a70acf30f62?db=08a02c6880344364ae86e63688660fbd&pvs=21))
    - On Inbox Notes: **Actions** → related data source ✅ Actions ([Actions](https://www.notion.so/33132459790b81389db0000392254de6/ds/843b715aa5dd4672afc5123ba075b2c3?db=82d9b2f78f9c44f49cb9db9846e76c57&pvs=21))
- Rollups: none observed in schema.
- Formulas: none observed in schema.

## 4. Notion API Cookbook (NO DELETE)

### 4.1 Inbox Notes

### Create (pages.create)

**Endpoint**: `POST [https://api.notion.com/v1/pages](https://api.notion.com/v1/pages)`

**Headers**

```
Authorization: Bearer <NOTION_TOKEN>
Notion-Version: 2022-06-28
Content-Type: application/json
```

**Request JSON**

```json
{
  "parent": { "database_id": "<INBOX_DB_ID>" },
  "properties": {
    "Title": { "title": [{ "text": { "content": "WA: quick note — placeholder" } }] },
    "Status": { "select": { "name": "Inbox" } },
    "Source": { "select": { "name": "WhatsApp" } },
    "Message type": { "select": { "name": "Text" } },
    "Type": { "select": { "name": "Other" } },
    "Topic": { "multi_select": [{ "name": "PraxOS" }] },
    "Original text": { "rich_text": [{ "text": { "content": "<RAW_MESSAGE_TEXT>" } }] },
    "Clean text": { "rich_text": [{ "text": { "content": "<CLEAN_TEXT>" } }] },
    "Transcript": { "rich_text": [{ "text": { "content": "<TRANSCRIPT>" } }] },
    "Sender": { "rich_text": [{ "text": { "content": "<SENDER>" } }] },
    "External ID": { "rich_text": [{ "text": { "content": "<EXTERNAL_ID>" } }] },
    "Processing run id": { "rich_text": [{ "text": { "content": "<RUN_ID>" } }] },
    "Processed by": { "select": { "name": "None" } },
    "Errors": { "rich_text": [{ "text": { "content": "" } }] },
    "Captured at": { "date": { "start": "2025-12-20T12:00:00+01:00" } },
    "URL": { "url": "[https://example.com](https://example.com)" }
  }
}
```

**Field mapping notes**

- `parent.database_id` must be the database id of the underlying data source "📥 Inbox".
- For create/update payloads:
    - Title → `"Title": {"title": [...]}`
    - Select → `{"select": {"name": "<OPTION>"}}`
    - Multi-select → `{"multi_select": [{"name": "<OPTION>"}]}`
    - Date → `{"date": {"start": "<ISO>"}}`
    - URL → `{"url": "…"}`

### Update (pages.update)

**Endpoint**: `PATCH [https://api.notion.com/v1/pages/{page_id}](https://api.notion.com/v1/pages/{page_id})`

**A) Update workflow state**

```json
{
  "properties": {
    "Status": { "select": { "name": "Processing" } }
  }
}
```

**B) Link an existing action to this note (relation)**

```json
{
  "properties": {
    "Actions": {
      "relation": [
        { "id": "<ACTION_PAGE_ID>" }
      ]
    }
  }
}
```

**C) Update text field (replace vs append)**

```json
{
  "properties": {
    "Clean text": {
      "rich_text": [
        { "text": { "content": "<FULL_NEW_VALUE>" } }
      ]
    }
  }
}
```

Notes:

- Notion API updates for `rich_text` are **replace**, not append. To append, you must read the current value, concatenate client-side, then send the full result.

### Query (databases.query)

**Endpoint**: `POST [https://api.notion.com/v1/databases/{database_id}/query](https://api.notion.com/v1/databases/{database_id}/query)`

**A) “New / unprocessed” notes (by Status)**

```json
{
  "filter": {
    "property": "Status",
    "select": { "equals": "Inbox" }
  },
  "sorts": [
    { "property": "Captured at", "direction": "ascending" }
  ]
}
```

**B) Notes currently being processed**

```json
{
  "filter": {
    "property": "Status",
    "select": { "equals": "Processing" }
  }
}
```

**C) Notes that reference a specific action (relation contains)**

```json
{
  "filter": {
    "property": "Actions",
    "relation": { "contains": "<ACTION_PAGE_ID>" }
  }
}
```

### 4.2 Inbox Actions

### Create (pages.create)

**Endpoint**: `POST [https://api.notion.com/v1/pages](https://api.notion.com/v1/pages)`

**Headers**

```
Authorization: Bearer <NOTION_TOKEN>
Notion-Version: 2022-06-28
Content-Type: application/json
```

**Request JSON**

```json
{
  "parent": { "database_id": "<ACTIONS_DB_ID>" },
  "properties": {
    "Title": { "title": [{ "text": { "content": "Create task: placeholder" } }] },
    "Status": { "select": { "name": "Proposed" } },
    "Action type": { "select": { "name": "Create" } },
    "Agent": { "select": { "name": "TodoAgent" } },
    "Priority": { "select": { "name": "Medium" } },
    "User notify": { "checkbox": false },
    "User WA": { "rich_text": [{ "text": { "content": "<USER_WA>" } }] },
    "External correlation id": { "rich_text": [{ "text": { "content": "<CORRELATION_ID>" } }] },
    "Approval token": { "rich_text": [{ "text": { "content": "<APPROVAL_TOKEN>" } }] },
    "Payload (JSON)": { "rich_text": [{ "text": { "content": "{\"op\":\"create\",\"data\":{}}" } }] },
    "Execution log": { "rich_text": [{ "text": { "content": "" } }] },
    "Due date": { "date": { "start": "2025-12-27" } },
    "Source note": { "relation": [{ "id": "<NOTE_PAGE_ID>" }] }
  }
}
```

### Update (pages.update)

**Endpoint**: `PATCH [https://api.notion.com/v1/pages/{page_id}](https://api.notion.com/v1/pages/{page_id})`

**A) Update workflow state**

```json
{
  "properties": {
    "Status": { "select": { "name": "Approved" } }
  }
}
```

**B) Link to (or change) source note**

```json
{
  "properties": {
    "Source note": {
      "relation": [
        { "id": "<NOTE_PAGE_ID>" }
      ]
    }
  }
}
```

**C) Update text payload (replace)**

```json
{
  "properties": {
    "Payload (JSON)": {
      "rich_text": [
        { "text": { "content": "{\"example\":true}" } }
      ]
    }
  }
}
```

### Query (databases.query)

**Endpoint**: `POST [https://api.notion.com/v1/databases/{database_id}/query](https://api.notion.com/v1/databases/{database_id}/query)`

**A) “Open” actions (example: Proposed + Needs approval + Approved + Executing)**

```json
{
  "filter": {
    "or": [
      { "property": "Status", "select": { "equals": "Proposed" } },
      { "property": "Status", "select": { "equals": "Needs approval" } },
      { "property": "Status", "select": { "equals": "Approved" } },
      { "property": "Status", "select": { "equals": "Executing" } }
    ]
  },
  "sorts": [
    { "property": "Priority", "direction": "descending" }
  ]
}
```

**B) Actions for a specific note (relation contains)**

```json
{
  "filter": {
    "property": "Source note",
    "relation": { "contains": "<NOTE_PAGE_ID>" }
  }
}
```

**C) Actions created within the last X days (by created_time)**

Use only if needed for your pipeline; `created_time` is always available on pages.

```json
{
  "filter": {
    "timestamp": "created_time",
    "created_time": { "on_or_after": "2025-12-13T00:00:00+01:00" }
  }
}
```

## 5. Minimal Ingestion Mapping (Observed)

- Inbox Notes (📥 Inbox / [Inbox](https://www.notion.so/33132459790b81389db0000392254de6/ds/fd13e74a1128495fae248a70acf30f62?db=08a02c6880344364ae86e63688660fbd&pvs=21))
    - Message body (raw): **Original text**
    - Cleaned/normalized text: **Clean text**
    - Speech-to-text output: **Transcript**
    - Media attachments: **Media** (files)
    - Sender identifier: **Sender**
    - Source channel: **Source** (e.g., WhatsApp)
    - Message format category: **Message type** (Text/Image/Video/Audio/Document/Mixed)
    - External idempotency key: **External ID**
    - Processing lifecycle: **Status** (Inbox/Processing/Processed/Archived/DeletedCandidate)
    - Processing metadata: **Processing run id**, **Processed by**, **Errors**
    - Capture timestamp: **Captured at**
    - Optional classification: **Type**, **Topic**
    - Optional URL: **URL**
    - Link to proposed/executed work: **Actions** (relation to ✅ Actions)
- Inbox Actions (✅ Actions / [Actions](https://www.notion.so/33132459790b81389db0000392254de6/ds/843b715aa5dd4672afc5123ba075b2c3?db=82d9b2f78f9c44f49cb9db9846e76c57&pvs=21))
    - Action title: **Title**
    - Workflow state: **Status** (Proposed/Needs approval/Approved/Rejected/Executing/Done/Failed)
    - Operation kind: **Action type** (Create/Update/Move/Delete/Notify/Enrich)
    - Routing/owner agent: **Agent** (TodoAgent/KnowledgeAgent/CalendarAgent/PromptAgent/FinanceAgent)
    - Priority: **Priority** (Low/Medium/High/Urgent)
    - Due date: **Due date**
    - Execution bookkeeping: **Approval token**, **Execution log**, **External correlation id**
    - Payload carrier: **Payload (JSON)** (rich text holding JSON string)
    - Notification flag: **User notify** (checkbox)
    - User identifier: **User WA**
    - Backlink to origin: **Source note** (relation to 📥 Inbox)

## 6. Open Questions (ONLY IF REQUIRED)

- None (schema + state fields are explicit: Inbox Notes uses **Status**; Inbox Actions uses **Status**).

---

## 7. Real System Identifiers (Current Configuration)

<aside>
⚠️

**WARNING: The identifiers below are strictly tied to the current Notion workspace configuration.**

These IDs are valid ONLY for this specific workspace and will NOT work in other Notion workspaces or if the databases are recreated. If the databases are deleted and recreated, all IDs below will become invalid and must be updated.

</aside>

### Parent Page

- **Page name**: PraxOS – Notes & Actions Hub
- **Page ID** (for API operations): `146e0b1ad6cb80238e95e51b2e43ec21`
- **Page URL**: [PraxOS – Notes & Actions Hub](https://www.notion.so/PraxOS-Notes-Actions-Hub-0b80a2d5448c4d2e8998c3ae265cfb12?pvs=21)

### Inbox Notes Database

- **Database name** (view container): View of Inbox
- **Database URL**: [](https://www.notion.so/63256a187ac44648aa05e10efedcc7e8?pvs=21)
- **Database ID** (for API parent reference): `63256a187ac44648aa05e10efedcc7e8`
- **Data source name**: 📥 Inbox
- **Data source ID** (for API database queries): `fd13e74a-1128-495f-ae24-8a70acf30f62`
- **Data source URL** (collection URI): `[Inbox](https://www.notion.so/33132459790b81389db0000392254de6/ds/fd13e74a1128495fae248a70acf30f62?db=08a02c6880344364ae86e63688660fbd&pvs=21)`

### Inbox Actions Database

- **Database name** (view container): View of Actions
- **Database URL**: [](https://www.notion.so/1c220ddedf7a466994395d9290525a53?pvs=21)
- **Database ID** (for API parent reference): `1c220ddedf7a466994395d9290525a53`
- **Data source name**: ✅ Actions
- **Data source ID** (for API database queries): `843b715a-a5dd-4672-afc5-123ba075b2c3`
- **Data source URL** (collection URI): `[Actions](https://www.notion.so/33132459790b81389db0000392254de6/ds/843b715aa5dd4672afc5123ba075b2c3?db=82d9b2f78f9c44f49cb9db9846e76c57&pvs=21)`

### Usage Notes

- **For pages.create**: Use the **data source ID** (not the database ID) in `parent.database_id`
    - Inbox Notes: `fd13e74a-1128-495f-ae24-8a70acf30f62`
    - Inbox Actions: `843b715a-a5dd-4672-afc5-123ba075b2c3`
- **For databases.query**: Use the **data source ID** in the endpoint path
    - Inbox Notes: `POST [https://api.notion.com/v1/databases/fd13e74a-1128-495f-ae24-8a70acf30f62/query](https://api.notion.com/v1/databases/fd13e74a-1128-495f-ae24-8a70acf30f62/query)`
    - Inbox Actions: `POST [https://api.notion.com/v1/databases/843b715a-a5dd-4672-afc5-123ba075b2c3/query](https://api.notion.com/v1/databases/843b715a-a5dd-4672-afc5-123ba075b2c3/query)`
- **For pages.update**: Use the **page ID** (individual record ID) from query results
- **For relations**: Use the **page URLs/IDs** of specific records, not database or data source IDs