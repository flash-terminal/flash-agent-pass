// FLASH Agent Pass gate (AWS Lambda, Node.js). One dependency: ethers (signature check).
//
// Two steps:
//   1. GET  ?address=0x...                      -> does this wallet have a pass? If yes, returns the
//                                                  text the wallet must sign.
//   2. POST {address, expires, signature[, signatureRecovery]}
//                                               -> checks that the signature was made by that wallet
//                                                  and that the wallet has a pass, then returns the
//                                                  MCP lane token.
//
// A wallet address alone never returns the token: addresses are public.
//
// Settings (Lambda environment variables):
//   PASS_CONTRACT   FlashPass contract address on BSC (0x + 40 hex)
//   MCP_PASS_TOKEN  the lane token the MCP server checks. Secret. Never logged.
//   BSC_RPC_URLS    optional, comma separated. Defaults to public BSC nodes.

import { verifyTypedData } from 'ethers';

const IS_ACTIVE = '0x9f8a13d7'; // isActive(address)
const DEFAULT_RPCS = [
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-rpc.publicnode.com',
  'https://bsc.drpc.org',
];
const MCP_URL = 'https://api.flash.im/mcp';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-f]{130}$/;
const RPC_TIMEOUT_MS = 4000;
const CHAIN_ID = 56;
/** How long a signature stays usable: 7 days. The pass and the Agent ID are read from the chain again every time it is used. */
const SIGN_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const PURPOSE = 'Get the FLASH Agent Pass lane token';

const TYPES = {
  PassCheck: [
    { name: 'wallet', type: 'address' },
    { name: 'purpose', type: 'string' },
    { name: 'expires', type: 'uint256' },
  ],
};
const DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify(body),
});

const domainFor = (contract) => ({
  name: 'FLASH Agent Pass',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: contract,
});

const messageFor = (wallet, expires) => ({
  wallet,
  purpose: PURPOSE,
  expires,
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

/** True when `signature` over (wallet, purpose, expires) was made by `wallet`. */
export function signedByWallet(contract, wallet, expires, signature) {
  try {
    const signer = verifyTypedData(
      domainFor(contract),
      TYPES,
      messageFor(wallet, expires),
      signature,
    );

    return signer.toLowerCase() === wallet.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Accepts the two shapes wallets hand out and returns one: 0x + r + s + v (65 bytes).
 *   - one string of 65 bytes, with or without 0x
 *   - r + s (64 bytes, with or without 0x) plus a separate recovery value ("00"/"01" or "1b"/"1c")
 * Returns undefined when the input is neither.
 */
export function normalizeSignature(signature, recovery) {
  if (typeof signature !== 'string') {
    return undefined;
  }

  const hex = signature.trim().toLowerCase().replace(/^0x/, '');

  if (/^[0-9a-f]{130}$/.test(hex)) {
    return `0x${hex}`;
  }

  if (/^[0-9a-f]{128}$/.test(hex) && (typeof recovery === 'string' || typeof recovery === 'number')) {
    const v = String(recovery).trim().toLowerCase().replace(/^0x/, '').padStart(2, '0');

    if (['00', '01', '1b', '1c'].includes(v)) {
      return `0x${hex}${v}`;
    }
  }

  return undefined;
}

function readBody(event) {
  if (typeof event?.body !== 'string' || event.body.length === 0) {
    return undefined;
  }

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    const parsed = JSON.parse(raw);

    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const NO_PASS = (contract) =>
  json(200, {
    pass: false,
    message:
      'This wallet has no FLASH Agent Pass, or no longer holds an Agent ID. Claim the pass first.',
    contract,
  });

const CHAIN_DOWN = () =>
  json(503, { error: 'Could not read BNB Smart Chain. Try again in a minute.' });

export async function handler(event) {
  const method = event?.requestContext?.http?.method ?? 'GET';

  if (method !== 'GET' && method !== 'POST') {
    return json(405, { error: 'Use GET or POST.' });
  }

  // Lower case throughout: the same address in mixed case must not change the outcome.
  const contract = (process.env.PASS_CONTRACT ?? '').trim().toLowerCase();
  const token = (process.env.MCP_PASS_TOKEN ?? '').trim();

  if (!ADDRESS.test(contract) || token.length === 0) {
    return json(503, { error: 'The pass gate is not open yet.' });
  }

  const configured = (process.env.BSC_RPC_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  const rpcUrls = configured.length > 0 ? configured : DEFAULT_RPCS;
  const now = Math.floor(Date.now() / 1000);

  // Step 1: is there a pass, and what should the wallet sign?
  if (method === 'GET') {
    const address = event?.queryStringParameters?.address?.trim().toLowerCase();

    if (typeof address !== 'string' || !ADDRESS.test(address)) {
      return json(400, {
        error: 'Send address: a wallet address, 0x followed by 40 hex characters.',
      });
    }

    const active = await hasActivePass(rpcUrls, contract, address);

    if (active === null) {
      return CHAIN_DOWN();
    }

    if (!active) {
      return NO_PASS(contract);
    }

    const expires = now + SIGN_WINDOW_SECONDS;
    const typedData = {
      domain: domainFor(contract),
      primaryType: 'PassCheck',
      types: { EIP712Domain: DOMAIN_TYPE, ...TYPES },
      message: messageFor(address, expires),
    };

    return json(200, {
      pass: true,
      next: 'Sign the request below with this wallet, then POST {address, expires, signature} to this URL. If the wallet returns signatureRecovery apart from signature, send it too.',
      expires,
      // The exact string a wallet command line takes for an EIP-712 signature.
      signRequest: JSON.stringify({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData)],
      }),
    });
  }

  // Step 2: the signature proves the caller controls the wallet.
  const body = readBody(event);
  const address =
    typeof body?.address === 'string' ? body.address.trim().toLowerCase() : undefined;
  const signature = normalizeSignature(body?.signature, body?.signatureRecovery);
  const expires = Number(body?.expires);

  if (address === undefined || !ADDRESS.test(address)) {
    return json(400, {
      error: 'Send address: a wallet address, 0x followed by 40 hex characters.',
    });
  }

  if (signature === undefined || !SIGNATURE.test(signature)) {
    return json(400, {
      error:
        'Send signature: 65 bytes as hex, or 64 bytes as hex together with signatureRecovery.',
    });
  }

  if (!Number.isSafeInteger(expires)) {
    return json(400, { error: 'Send expires: the number returned with the sign request.' });
  }

  if (expires < now) {
    return json(401, { error: 'The signature has expired. Start again with GET.' });
  }

  if (expires > now + SIGN_WINDOW_SECONDS) {
    return json(400, { error: 'expires is too far ahead. Start again with GET.' });
  }

  if (!signedByWallet(contract, address, expires, signature)) {
    return json(401, { error: 'The signature was not made by this wallet.' });
  }

  const active = await hasActivePass(rpcUrls, contract, address);

  if (active === null) {
    return CHAIN_DOWN();
  }

  if (!active) {
    return NO_PASS(contract);
  }

  return json(200, {
    pass: true,
    mcp: {
      url: MCP_URL,
      header: 'Authorization',
      value: `Bearer ${token}`,
    },
  });
}
