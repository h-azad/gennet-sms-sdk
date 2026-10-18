# gennet-sms-sdk

Node.js SDK for the **GenNet Push SMS Connectivity API v3.0.0** — send single, bulk and dynamic SMS, query delivery status, check balance, transfer balance between sender IDs, and list incoming messages.

- Zero runtime dependencies (uses the built-in `fetch`)
- Dual ESM / CommonJS
- Node.js >= 18

## Install

```bash
npm install gennet-sms-sdk
```

## Quick start

```js
import GennetSMS from 'gennet-sms-sdk';

const sms = new GennetSMS({
  apiToken: 'your-api-token',            // provided by GenNet
  baseUrl: 'https://api.gennet.com.bd',  // your gateway domain — required, no default
  sid: 'YourSenderID',                   // optional default sender ID
});

const [result] = await sms.sendSingle({
  msisdn: '88019XXXXXXXX',
  sms: 'Your verification code is 1234',
  csmsId: 'J2TQTTOU4D62H3HJMHYG',                  // 20 character  lenght unique string for each SMS there will be a reference ID from Client. The csms_id will be unique for the same day only
});

console.log(result.reference_id);        // GenNet reference ID — use it with getStatus()
```

`sid` may be omitted per call and taken from the constructor default, or passed per call to override it.

## API

All methods are `async`, validate their arguments, and **reject before any HTTP request** is sent when a required parameter is missing. Success returns the relevant slice of the API response; failure throws [`GennetSMSError`](#errors).

| Method | Endpoint | Returns |
|---|---|---|
| `sendSingle({ msisdn, sms, csmsId, sid? })` | `POST /api/v3/send-sms` | `smsinfo[]` — one SMS detail object |
| `sendBulk({ msisdn[], sms, batchCsmsId, sid? })` | `POST /api/v3/send-sms/bulk` | `smsinfo[]` — one object per MSISDN (max 100) |
| `sendDynamic({ sms[], sid? })` | `POST /api/v3/send-sms/dynamic` | `smsinfo[]` — one object per entry (max 100) |
| `getStatus({ referenceId })` | `GET /api/v3/send-sms/status` | `smsinfo[]` — delivery status object |
| `getBalance()` | `GET /api/v3/balance` | `smsinfo.balance_info[]` — `{ sender_id, sms_balance }` |
| `transferBalance({ fromSid, toSid, transferAmount, remarks? })` | `POST /api/v3/transfer-balance` | transfer summary `data` object |
| `getIncomingMessages()` | `GET /api/v3/incoming-messages-list` | `messages[]` |

**Reference IDs must be exactly 20 characters.** `csmsId` (single and per dynamic entry) and `batchCsmsId` (bulk) are validated client-side against the API's fixed length; anything else throws a `TypeError` before a request is sent. A reference ID only needs to be unique per day.

### Send a single SMS

```js
const info = await sms.sendSingle({
  msisdn: '88019XXXXXXXX',
  sms: 'Message body',
  csmsId: 'QAN9GOGJXG6U4D9MU5YJ',
});
```

`csmsId` must be exactly 20 characters (unique per day).

### Send bulk SMS

Same body to up to 100 MSISDNs. `msisdn` is an array; `batchCsmsId` is the request-level reference ID.

```js
const info = await sms.sendBulk({
  msisdn: ['88019XXXXXXXX', '88017XXXXXXXX', '88018XXXXXXXX'],
  sms: 'Message body',
  batchCsmsId: 'J2TQTTOU4D62H3HJMHYG',
});
```

`batchCsmsId` must be exactly 20 characters (unique per day).

### Send dynamic SMS

Up to 100 entries, each with its own body and MSISDN.

```js
const info = await sms.sendDynamic({
  sms: [
    { msisdn: '88019XXXXXXXX', text: 'Message body 1', csmsId: 'J5JR4YQJUVEM5DZMXOXX' },
    { msisdn: '88017XXXXXXXX', text: 'Message body 2', csmsId: '2ASZWRVITPFTJXLVX7WU' },
  ],
});
```

Each `csmsId` must be exactly 20 characters (unique per day).

Each entry is returned with a GenNet `reference_id`.

### Check delivery status

```js
const [status] = await sms.getStatus({ referenceId: '5da2f0b5ba3a2248110' });
console.log(status.sms_status, status.status_message); // e.g. "Delivered" "Success"
```

### Check balance

```js
const balances = await sms.getBalance();
// [{ sender_id: 'YourSenderID', sms_balance: 9404.52 }]
```

### Transfer balance

Moves balance between two sender IDs belonging to the same API user. `transferAmount` must be at least 1; `fromSid` and `toSid` must differ.

```js
const summary = await sms.transferBalance({
  fromSid: 'SourceBrand',
  toSid: 'TargetBrand',
  transferAmount: 100,
  remarks: 'Balance re-allocation', // optional
});
// { from_sid, to_sid, transferred_sms, from_sid_balance, to_sid_balance }
```

### List incoming messages

```js
const messages = await sms.getIncomingMessages();
// [{ id, sender, receiver, message, smscount, created_at, ... }]
```

## Errors

Any response that is not `SUCCESS` — or whose `error` field is `true` — rejects with `GennetSMSError`, which carries the API's failure details:

```js
import GennetSMS, { GennetSMSError } from 'gennet-sms-sdk';

try {
  await sms.sendSingle({ msisdn: '88019XXXXXXXX', sms: 'Hi', csmsId: 'C1' });
} catch (err) {
  if (err instanceof GennetSMSError) {
    console.error(err.statusCode, err.errorMessage); // e.g. 4022 "Required Parameter Missing"
  } else {
    throw err; // TypeError / RangeError from argument validation
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `err.statusCode` | `number` | API status code (`200` success; `4001`–`4031`, `5000` failures — see the spec's status code table) |
| `err.errorMessage` | `string` | API `error_message` |
| `err.message` | `string` | Human-readable description, includes the endpoint |

Network failures, non-JSON responses, and HTTP errors also reject with `GennetSMSError`.

**Retry policy is the caller's responsibility** — the SDK performs a single attempt per call. Status code `4029` (too many requests) and `4031` (TPS exceeded) are safe to retry with backoff.

## Usage from CommonJS

```js
const GennetSMS = require('gennet-sms-sdk');
// or named: const { GennetSMS, GennetSMSError } = require('gennet-sms-sdk');
```

## Configuration

| Option | Type | Required | Description |
|---|---|---|---|
| `apiToken` | `string` | yes | GenNet API token |
| `baseUrl` | `string` | yes | Gateway base URL, e.g. `https://api.gennet.com.bd`. No default is assumed; trailing slashes are stripped |
| `sid` | `string` | no | Default sender ID, used when a call omits `sid` |

## Development

```bash
npm install
npm run build        # regenerate dist/cjs/index.cjs from src/index.js
```

Source of truth is `src/index.js` (ESM); `scripts/build.cjs` emits the CommonJS build. `prepublishOnly` runs the build automatically before `npm publish`.

## License

ISC
