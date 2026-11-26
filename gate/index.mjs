// FLASH Agent Pass gate (AWS Lambda, Node.js). No dependencies.
//
// The gate stands in front of the FLASH news MCP server. An agent sends its MCP calls here together
// with a wallet address. The gate reads the FlashPass contract on BNB Smart Chain:
//
//   wallet holds a pass          -> the call goes on to the MCP server on the pass holders' lane
//   no pass, no wallet, or the
//   chain cannot be read         -> the call goes on to the MCP server on the public lane
//
// Nothing is refused and the MCP server's answer is returned as it is. The only thing the gate adds
// is two response headers that say which lane the call took.
//
//   POST  ?wallet=0x...   (or header X-Flash-Wallet)   an MCP call (JSON-RPC body), passed through
//   GET   ?address=0x...                               does this wallet have a pass? {pass: true|false}
//
// This is a read-only news service, so the gate does not ask the wallet to prove anything. A wallet
// address is public: the pass decides which lane a call takes, it is not a secret.
//
// Settings (Lambda environment variables):
//   PASS_CONTRACT     FlashPass contract address on BSC (0x + 40 hex)
//   MCP_PASS_TOKEN    the lane token the MCP server checks. Secret. It never leaves this function
//                     except in the request to the MCP server. Never logged, never returned.
//   BSC_RPC_URLS      optional, comma separated. Defaults to public BSC nodes.
//   MCP_UPSTREAM_URL  optional. Defaults to the production MCP server.

const IS_ACTIVE = '0x9f8a13d7'; // isActive(address)
const DEFAULT_RPCS = [
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-rpc.publicnode.com',
  'https://bsc.drpc.org',
];
const DEFAULT_MCP_URL = 'https://api.flash.im/mcp';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RPC_TIMEOUT_MS = 4000;
const UPSTREAM_TIMEOUT_MS = 12000;
const MAX_BODY_BYTES = 100 * 1024;

/** How long an answer from the chain is remembered, per wallet. A fresh claim shows up within 30 seconds. */
const REMEMBER_PASS_MS = 5 * 60 * 1000;
const REMEMBER_NO_PASS_MS = 30 * 1000;
const REMEMBER_MAX_WALLETS = 5000;
const remembered = new Map(); // wallet -> { active, until }

/** Request headers passed on to the MCP server. Authorization is never taken from the caller. */
const FORWARD_HEADERS = ['content-type', 'accept', 'mcp-protocol-version', 'user-agent'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, X-Flash-Wallet',
  'Access-Control-Expose-Headers': 'X-Flash-Lane, X-Flash-Lane-Reason',
};

const json = (statusCode, body, extra = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra },
  body: JSON.stringify(body),
});

/** Asks one node. Returns true/false, or throws if the node did not give a usable answer. */
async function askNode(url, contract, wallet) {
  const data = IS_ACTIVE + wallet.slice(2).toLowerCase().padStart(64, '0');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: contract, data }, 'latest'],
    }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  const body = await response.json();

  // A real answer is one 32-byte word. Anything else (an error, or "0x" when the
  // address has no contract) is not an answer, so the next node is tried.
  if (typeof body.result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.result)) {
    throw new Error('no usable answer');
  }

  return BigInt(body.result) !== 0n;
}

/** Tries each node in order. Returns true/false, or null when no node answered. */
export async function hasActivePass(rpcUrls, contract, wallet) {
  for (const url of rpcUrls) {
    try {
      return await askNode(url, contract, wallet);
    } catch {
      // try the next node
    }
  }

  return null;
}

/** The same question, remembered for a short time so that a run of calls reads the chain once. */
async function hasActivePassRemembered(rpcUrls, contract, wallet, now) {
  const key = `${contract}:${wallet}`;
  const hit = remembered.get(key);

  if (hit && hit.until > now) {
    return hit.active;
  }

  const active = await hasActivePass(rpcUrls, contract, wallet);

  // "The chain did not answer" is not remembered: the next call asks again.
  if (active !== null) {
    if (remembered.size >= REMEMBER_MAX_WALLETS) {
      remembered.clear();
    }

    remembered.set(key, {
      active,
      until: now + (active ? REMEMBER_PASS_MS : REMEMBER_NO_PASS_MS),
    });
  }

  return active;
}

/** For tests. */
export function forgetAll() {
  remembered.clear();
}

function readSettings() {
  // Lower case throughout: the same address in mixed case must not change the outcome.
  const contract = (process.env.PASS_CONTRACT ?? '').trim().toLowerCase();
  const token = (process.env.MCP_PASS_TOKEN ?? '').trim();
  const configured = (process.env.BSC_RPC_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  return {
    contract: ADDRESS.test(contract) ? contract : undefined,
    token: token.length > 0 ? token : undefined,
    rpcUrls: configured.length > 0 ? configured : DEFAULT_RPCS,
    upstream: (process.env.MCP_UPSTREAM_URL ?? '').trim() || DEFAULT_MCP_URL,
  };
}

function lowerCaseHeaders(event) {
  const headers = {};

  for (const [name, value] of Object.entries(event?.headers ?? {})) {
    if (typeof value === 'string') {
      headers[name.toLowerCase()] = value;
    }
  }

  return headers;
}

function readWallet(event, headers) {
  const query = event?.queryStringParameters ?? {};
  const raw = query.wallet ?? query.address ?? headers['x-flash-wallet'];

  if (typeof raw !== 'string') {
    return undefined;
  }

  const wallet = raw.trim().toLowerCase();

  return ADDRESS.test(wallet) ? wallet : undefined;
}

/** Which lane does this call take, and why. The reason is shown to the caller; the token never is. */
async function chooseLane(settings, wallet, now) {
  if (!settings.contract || !settings.token) {
    return { lane: 'public', reason: 'gate-not-configured' };
  }

  if (!wallet) {
    return { lane: 'public', reason: 'no-wallet' };
  }

  const active = await hasActivePassRemembered(settings.rpcUrls, settings.contract, wallet, now);

  if (active === null) {
    return { lane: 'public', reason: 'chain-unavailable' };
  }

  return active ? { lane: 'pass', reason: 'pass' } : { lane: 'public', reason: 'no-pass' };
}

/** Sends the MCP call on and returns the MCP server's answer as it is. */
async function passThrough(event, headers, settings, choice) {
  const laneHeaders = { 'X-Flash-Lane': choice.lane, 'X-Flash-Lane-Reason': choice.reason };
  const body =
    typeof event?.body === 'string'
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body
      : '';

  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { error: 'The request body is too large.' }, laneHeaders);
  }

  const outgoing = {};

  for (const name of FORWARD_HEADERS) {
    if (headers[name]) {
      outgoing[name] = headers[name];
    }
  }

  if (choice.lane === 'pass') {
    outgoing.authorization = `Bearer ${settings.token}`;
  }

  let response;
  let text;

  try {
    response = await fetch(settings.upstream, {
      method: 'POST',
      headers: outgoing,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    text = await response.text();
  } catch {
    return json(502, { error: 'The FLASH MCP server did not answer. Try again in a minute.' }, laneHeaders);
  }

  // A redirect would carry the lane token somewhere else. It is not followed.
  if (response.status >= 300 && response.status < 400) {
    return json(502, { error: 'The FLASH MCP server did not answer. Try again in a minute.' }, laneHeaders);
  }

  return {
    statusCode: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
      ...CORS,
      ...laneHeaders,
    },
    body: text,
  };
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method ?? 'GET';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { ...CORS }, body: '' };
  }

  if (method !== 'GET' && method !== 'POST') {
    return json(405, { error: 'Use GET or POST.' });
  }

  const settings = readSettings();
  const headers = lowerCaseHeaders(event);
  const wallet = readWallet(event, headers);
  const now = Date.now();

  // An MCP call: choose the lane and pass it on.
  if (method === 'POST') {
    return passThrough(event, headers, settings, await chooseLane(settings, wallet, now));
  }

  // A plain question: does this wallet have a pass?
  if (!settings.contract) {
    return json(503, { error: 'The pass gate is not open yet.' });
  }

  if (!wallet) {
    return json(400, {
      error: 'Send address: a wallet address, 0x followed by 40 hex characters.',
    });
  }

  const active = await hasActivePass(settings.rpcUrls, settings.contract, wallet);

  if (active === null) {
    return json(503, { error: 'Could not read BNB Smart Chain. Try again in a minute.' });
  }

  return json(200, {
    pass: active,
    contract: settings.contract,
    message: active
      ? 'This wallet holds a FLASH Agent Pass. Send MCP calls to this gate with ?wallet=<address> to read on the pass holders\' lane.'
      : 'This wallet has no FLASH Agent Pass, or no longer holds an Agent ID. Claim the pass first. Until then its calls take the public lane.',
  });
}
