/**
 * GenNet Push SMS Connectivity API v3.0.0 — Node.js SDK.
 *
 * Endpoints wrapped (all under `<baseUrl>/api/v3`):
 *   POST /send-sms                  sendSingle
 *   POST /send-sms/bulk             sendBulk
 *   POST /send-sms/dynamic          sendDynamic
 *   GET  /send-sms/status           getStatus
 *   GET  /balance                   getBalance
 *   POST /transfer-balance          transferBalance
 *   GET  /incoming-messages-list    getIncomingMessages
 *
 * Uses the built-in `fetch` (Node >= 18). No runtime dependencies.
 */

/** Exact length required by the API for `csms_id` and `batch_csms_id`. */
const CSMS_ID_LENGTH = 20;

const API_VERSION = '/api/v3';

/** Maximum number of MSISDN/SMS entries accepted by the bulk and dynamic endpoints. */
const MAX_ENTRIES_PER_REQUEST = 100;

/** Error raised for any non-SUCCESS API response or rejected request. */
class GennetSMSError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode] API `status_code` from the failure response
   * @param {string} [errorMessage] API `error_message` from the failure response
   */
  constructor(message, statusCode, errorMessage) {
    super(message);
    this.name = 'GennetSMSError';
    this.statusCode = statusCode;
    this.errorMessage = errorMessage;
  }
}

/** @typedef {{text: string, msisdn: string, csmsId: string}} DynamicSmsEntry */

class GennetSMS {
  /**
   * @param {{apiToken: string, baseUrl: string, sid?: string}} options
   */
  constructor({ apiToken, baseUrl, sid } = {}) {
    if (typeof apiToken !== 'string' || apiToken.length === 0) {
      throw new TypeError('GennetSMS: "apiToken" is required and must be a non-empty string.');
    }
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
      throw new TypeError('GennetSMS: "baseUrl" is required and must be a non-empty string.');
    }
    if (sid !== undefined && (typeof sid !== 'string' || sid.length === 0)) {
      throw new TypeError('GennetSMS: "sid" must be a non-empty string when provided.');
    }

    this.apiToken = apiToken;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    /** @type {string|undefined} Default sender ID used when a call omits `sid`. */
    this.sid = sid;
  }

  /**
   * Core HTTP helper. GET sends parameters as a query string, POST sends them
   * as a JSON body (both carry `api_token`, per the spec).
   *
   * @param {'GET'|'POST'} method
   * @param {string} path Path below the base URL, e.g. `/api/v3/send-sms`.
   * @param {Record<string, unknown>} [body] JSON body for POST requests.
   * @param {Record<string, unknown>} [queryParams] Extra query-string parameters for GET requests.
   * @returns {Promise<any>} Parsed response payload.
   * @throws {GennetSMSError} When the API reports a failure or the response is not JSON.
   */
  async _request(method, path, body, queryParams) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (method === 'GET') {
      url.searchParams.set('api_token', this.apiToken);
      for (const [key, value] of Object.entries(queryParams || {})) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    /** @type {Record<string, string>} */
    const headers = {
      Accept: 'application/json',
    };
    /** @type {RequestInit} */
    const init = { method, headers };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify({ api_token: this.apiToken, ...(body || {}) });
    }

    /** @type {Response} */
    let response;
    try {
      response = await fetch(url, init);
    } catch (cause) {
      throw new GennetSMSError(
        `GennetSMS: request to ${method} ${path} failed: ${cause && cause.message}`,
      );
    }

    /** @type {any} */
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new GennetSMSError(
        `GennetSMS: ${method} ${path} returned non-JSON response (HTTP ${response.status}).`,
      );
    }

    if (payload && payload.error === true) {
      throw new GennetSMSError(
        payload.error_message || 'GennetSMS: request failed.',
        payload.status_code,
        payload.error_message,
      );
    }

    if (payload && payload.status !== undefined && payload.status !== 'SUCCESS') {
      throw new GennetSMSError(
        `GennetSMS: ${method} ${path} failed with status ${payload.status}.`,
        payload.status_code,
        payload.error_message,
      );
    }

    return payload;
  }

  /**
   * Resolve the sender ID for a call, falling back to the constructor default.
   * @param {string|undefined} sid
   * @param {'sendSingle'|'sendBulk'|'sendDynamic'} method
   * @returns {string}
   */
  _requireSid(sid, method) {
    const resolved = sid !== undefined ? sid : this.sid;
    if (typeof resolved !== 'string' || resolved.length === 0) {
      throw new TypeError(
        `GennetSMS.${method}: "sid" is required (pass it per call or set it in the constructor).`,
      );
    }
    return resolved;
  }

  /**
   * Send a single SMS. POST /api/v3/send-sms
   * @param {{msisdn: string, sms: string, csmsId: string, sid?: string}} params
   * @returns {Promise<Array>} `smsinfo` array with one SMS detail object.
   */
  async sendSingle({ msisdn, sms, csmsId, sid } = {}) {
    if (typeof msisdn !== 'string' || msisdn.length === 0) {
      throw new TypeError('GennetSMS.sendSingle: "msisdn" is required and must be a non-empty string.');
    }
    if (typeof sms !== 'string' || sms.length === 0) {
      throw new TypeError('GennetSMS.sendSingle: "sms" is required and must be a non-empty string.');
    }
    if (typeof csmsId !== 'string' || csmsId.length !== CSMS_ID_LENGTH) {
      throw new TypeError(
        `GennetSMS.sendSingle: "csmsId" is required and must be exactly ${CSMS_ID_LENGTH} characters.`,
      );
    }

    const payload = await this._request('POST', `${API_VERSION}/send-sms`, {
      sid: this._requireSid(sid, 'sendSingle'),
      msisdn,
      sms,
      csms_id: csmsId,
    });

    return (payload && payload.smsinfo) || [];
  }

  /**
   * Send the same SMS body to up to 100 MSISDNs. POST /api/v3/send-sms/bulk
   * @param {{msisdn: string[], sms: string, batchCsmsId: string, sid?: string}} params
   * @returns {Promise<Array>} `smsinfo` array with one SMS detail object per MSISDN.
   */
  async sendBulk({ msisdn, sms, batchCsmsId, sid } = {}) {
    if (!Array.isArray(msisdn) || msisdn.length === 0) {
      throw new TypeError('GennetSMS.sendBulk: "msisdn" is required and must be a non-empty array of strings.');
    }
    if (msisdn.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
      throw new TypeError('GennetSMS.sendBulk: every entry in "msisdn" must be a non-empty string.');
    }
    if (msisdn.length > MAX_ENTRIES_PER_REQUEST) {
      throw new RangeError(`GennetSMS.sendBulk: at most ${MAX_ENTRIES_PER_REQUEST} MSISDNs per request.`);
    }
    if (typeof sms !== 'string' || sms.length === 0) {
      throw new TypeError('GennetSMS.sendBulk: "sms" is required and must be a non-empty string.');
    }
    if (typeof batchCsmsId !== 'string' || batchCsmsId.length !== CSMS_ID_LENGTH) {
      throw new TypeError(
        `GennetSMS.sendBulk: "batchCsmsId" is required and must be exactly ${CSMS_ID_LENGTH} characters.`,
      );
    }

    const payload = await this._request('POST', `${API_VERSION}/send-sms/bulk`, {
      sid: this._requireSid(sid, 'sendBulk'),
      msisdn,
      sms,
      batch_csms_id: batchCsmsId,
    });

    return (payload && payload.smsinfo) || [];
  }

  /**
   * Send up to 100 SMS, each with its own body and MSISDN.
   * POST /api/v3/send-sms/dynamic
   * @param {{sms: DynamicSmsEntry[], sid?: string}} params
   * @returns {Promise<Array>} `smsinfo` array with one SMS detail object per entry.
   */
  async sendDynamic({ sms, sid } = {}) {
    if (!Array.isArray(sms) || sms.length === 0) {
      throw new TypeError('GennetSMS.sendDynamic: "sms" is required and must be a non-empty array.');
    }
    if (sms.length > MAX_ENTRIES_PER_REQUEST) {
      throw new RangeError(`GennetSMS.sendDynamic: at most ${MAX_ENTRIES_PER_REQUEST} SMS entries per request.`);
    }
    sms.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new TypeError(`GennetSMS.sendDynamic: entry at index ${index} must be an object.`);
      }
      if (typeof entry.msisdn !== 'string' || entry.msisdn.length === 0) {
        throw new TypeError(`GennetSMS.sendDynamic: entry at index ${index} requires a non-empty "msisdn" string.`);
      }
      if (typeof entry.text !== 'string' || entry.text.length === 0) {
        throw new TypeError(`GennetSMS.sendDynamic: entry at index ${index} requires a non-empty "text" string.`);
      }
      if (typeof entry.csmsId !== 'string' || entry.csmsId.length !== CSMS_ID_LENGTH) {
        throw new TypeError(
          `GennetSMS.sendDynamic: entry at index ${index} requires "csmsId" to be exactly ${CSMS_ID_LENGTH} characters.`,
        );
      }
    });

    const payload = await this._request('POST', `${API_VERSION}/send-sms/dynamic`, {
      sid: this._requireSid(sid, 'sendDynamic'),
      sms: sms.map(({ text, msisdn, csmsId }) => ({ text, msisdn, csms_id: csmsId })),
    });

    return (payload && payload.smsinfo) || [];
  }

  /**
   * Query delivery status by GenNet reference ID. GET /api/v3/send-sms/status
   * @param {{referenceId: string}} params
   * @returns {Promise<Array>} `smsinfo` array with the delivery status object.
   */
  async getStatus({ referenceId } = {}) {
    if (typeof referenceId !== 'string' || referenceId.length === 0) {
      throw new TypeError('GennetSMS.getStatus: "referenceId" is required and must be a non-empty string.');
    }

    const payload = await this._request(
      'GET',
      `${API_VERSION}/send-sms/status`,
      undefined,
      { reference_id: referenceId },
    );

    return (payload && payload.smsinfo) || [];
  }

  /**
   * Check available SMS balance per sender ID. GET /api/v3/balance
   * @returns {Promise<Array>} `smsinfo.balance_info` array.
   */
  async getBalance() {
    const payload = await this._request('GET', `${API_VERSION}/balance`);
    return (payload && payload.smsinfo && payload.smsinfo.balance_info) || [];
  }

  /**
   * Transfer SMS balance between two sender IDs of the same API user.
   * POST /api/v3/transfer-balance
   * @param {{fromSid: string, toSid: string, transferAmount: number, remarks?: string}} params
   * @returns {Promise<Object>} Transfer summary `data` object.
   */
  async transferBalance({ fromSid, toSid, transferAmount, remarks } = {}) {
    if (typeof fromSid !== 'string' || fromSid.length === 0) {
      throw new TypeError('GennetSMS.transferBalance: "fromSid" is required and must be a non-empty string.');
    }
    if (typeof toSid !== 'string' || toSid.length === 0) {
      throw new TypeError('GennetSMS.transferBalance: "toSid" is required and must be a non-empty string.');
    }
    if (fromSid === toSid) {
      throw new TypeError('GennetSMS.transferBalance: "fromSid" and "toSid" must differ.');
    }
    if (typeof transferAmount !== 'number' || !Number.isFinite(transferAmount) || transferAmount < 1) {
      throw new TypeError('GennetSMS.transferBalance: "transferAmount" must be a number of at least 1.');
    }
    if (remarks !== undefined && typeof remarks !== 'string') {
      throw new TypeError('GennetSMS.transferBalance: "remarks" must be a string when provided.');
    }

    const payload = await this._request('POST', `${API_VERSION}/transfer-balance`, {
      from_sid: fromSid,
      to_sid: toSid,
      transfer_amount: transferAmount,
      ...(remarks !== undefined ? { remarks } : {}),
    });

    return (payload && payload.data) || {};
  }

  /**
   * List incoming SMS received on configured non-masking sender IDs.
   * GET /api/v3/incoming-messages-list
   * @returns {Promise<Array>} `messages` array.
   */
  async getIncomingMessages() {
    const payload = await this._request('GET', `${API_VERSION}/incoming-messages-list`);
    return (payload && payload.messages) || [];
  }
}

export default GennetSMS;
export { GennetSMS, GennetSMSError };
