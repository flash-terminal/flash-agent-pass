// Checks for the pass gate. The chain and the MCP server are stand-ins, except the last two checks,
// which read the real pass contract on BNB Smart Chain (read only).
//   node test.mjs              all 32 checks
//   OFFLINE=1 node test.mjs    the 30 checks that need no network
import { handler, hasActivePass, forgetAll } from './index.mjs';

const CONTRACT = '0x61c712e373149cab2de86ed2aadacc568db91acb';
const HOLDER = '0x39217795fdbaceb25e62710d006ae68e30b5a3b1';
const NOBODY = '0x000000000000000000000000000000000000dead';
const TOKEN = 'test-lane-token-0123456789abcdef0123456789';
const UPSTREAM = 'https://mcp.test/mcp';
const RPC = 'https://rpc.test';
const WORD = (n) => '0x' + n.toString(16).padStart(64, '0');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log('PASS | ' + name); }
  else { failed += 1; console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
};

const realFetch = globalThis.fetch;
let chain = 'ok';          // ok | down
let upstreamMode = 'ok';   // ok | down | redirect | error
let seen = [];             // requests the gate sent to the MCP server
let rpcCalls = 0;

globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith(RPC)) {
    rpcCalls += 1;
    if (chain === 'down') throw new Error('down');
    const data = JSON.parse(init.body).params[0].data;
    const wallet = '0x' + data.slice(-40);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: WORD(wallet === HOLDER ? 1 : 0) }));
  }
  if (String(url) === UPSTREAM) {
    seen.push({ headers: { ...init.headers }, body: init.body, method: init.method });
    if (upstreamMode === 'down') throw new Error('down');
    if (upstreamMode === 'redirect') return new Response('', { status: 302, headers: { location: 'https://elsewhere.test/' } });
    if (upstreamMode === 'error') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"items":[1,2,3]}' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unexpected fetch ' + url);
};

const env = (over = {}) => {
  for (const k of ['PASS_CONTRACT', 'MCP_PASS_TOKEN', 'BSC_RPC_URLS', 'MCP_UPSTREAM_URL']) delete process.env[k];
  Object.assign(process.env, { PASS_CONTRACT: CONTRACT, MCP_PASS_TOKEN: TOKEN, BSC_RPC_URLS: RPC, MCP_UPSTREAM_URL: UPSTREAM }, over);
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete process.env[k];
};
const reset = () => { forgetAll(); chain = 'ok'; upstreamMode = 'ok'; seen = []; rpcCalls = 0; env(); };
const CALL = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_top_news', arguments: { category: 'crypto' } } });
const post = (query = {}, headers = {}, body = CALL, extra = {}) => handler({
  requestContext: { http: { method: 'POST' } },
  queryStringParameters: query,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
  body, ...extra,
});
const get = (query = {}) => handler({ requestContext: { http: { method: 'GET' } }, queryStringParameters: query, headers: {} });
const sentToken = () => seen.length > 0 && seen[seen.length - 1].headers.authorization === 'Bearer ' + TOKEN;
const noToken = () => seen.length > 0 && !('authorization' in seen[seen.length - 1].headers);
const leaks = (r) => JSON.stringify(r).includes(TOKEN);

// ---------------------------------------------------------------- lanes
reset();
let r = await post({ wallet: HOLDER });
check('holder: goes on with the lane token', r.statusCode === 200 && sentToken());
check('holder: lane headers say pass', r.headers['X-Flash-Lane'] === 'pass' && r.headers['X-Flash-Lane-Reason'] === 'pass');
check('holder: MCP answer is returned as it is', JSON.parse(r.body).result.content[0].text === '{"items":[1,2,3]}');
check('holder: the token is not in the response', !leaks(r));
check('holder: the call body is passed on unchanged', seen[0].body === CALL && seen[0].method === 'POST');
check('holder: content-type and accept are passed on', seen[0].headers['content-type'] === 'application/json' && /event-stream/.test(seen[0].headers.accept));

reset();
r = await post({ wallet: NOBODY });
check('no pass: goes on without a token (public lane)', r.statusCode === 200 && noToken() && r.headers['X-Flash-Lane'] === 'public' && r.headers['X-Flash-Lane-Reason'] === 'no-pass');

reset();
r = await post({});
check('no wallet: public lane, the chain is not read', r.statusCode === 200 && noToken() && r.headers['X-Flash-Lane-Reason'] === 'no-wallet' && rpcCalls === 0);

reset();
r = await post({ wallet: '0x1234' });
check('malformed wallet: public lane', r.statusCode === 200 && noToken() && r.headers['X-Flash-Lane-Reason'] === 'no-wallet');

reset();
r = await post({}, { 'X-Flash-Wallet': HOLDER });
check('wallet in the header works too', sentToken() && r.headers['X-Flash-Lane'] === 'pass');

reset();
r = await post({ wallet: HOLDER.toUpperCase().replace('0X', '0x') });
check('wallet in upper case: same outcome', sentToken() && r.headers['X-Flash-Lane'] === 'pass');

reset();
chain = 'down';
r = await post({ wallet: HOLDER });
check('chain cannot be read: public lane, still answered', r.statusCode === 200 && noToken() && r.headers['X-Flash-Lane-Reason'] === 'chain-unavailable');
chain = 'ok';
r = await post({ wallet: HOLDER });
check('chain back: a failed read was not remembered', sentToken());

// ---------------------------------------------------------------- what the caller cannot do
reset();
r = await post({ wallet: NOBODY }, { Authorization: 'Bearer ' + TOKEN });
check('a caller-sent Authorization header is not passed on', noToken() && r.headers['X-Flash-Lane'] === 'public');

reset();
r = await post({ wallet: NOBODY }, { Authorization: 'Bearer something-else', Cookie: 'a=b', 'X-Forwarded-For': '1.2.3.4' });
check('only the four listed headers are passed on', Object.keys(seen[0].headers).sort().join() === 'accept,content-type');

// ---------------------------------------------------------------- remembering
reset();
await post({ wallet: HOLDER }); await post({ wallet: HOLDER }); await post({ wallet: HOLDER });
check('three calls from a holder read the chain once', rpcCalls === 1 && seen.length === 3);

// ---------------------------------------------------------------- settings
reset(); env({ MCP_PASS_TOKEN: undefined });
r = await post({ wallet: HOLDER });
check('no token configured: public lane, still answered', r.statusCode === 200 && noToken() && r.headers['X-Flash-Lane-Reason'] === 'gate-not-configured');

reset(); env({ PASS_CONTRACT: 'not-an-address' });
r = await post({ wallet: HOLDER });
check('no contract configured: public lane, still answered', r.statusCode === 200 && noToken());

// ---------------------------------------------------------------- MCP server trouble
reset(); upstreamMode = 'down';
r = await post({ wallet: HOLDER });
check('MCP server does not answer: 502, no token in the answer', r.statusCode === 502 && !leaks(r) && r.headers['X-Flash-Lane'] === 'pass');

reset(); upstreamMode = 'redirect';
r = await post({ wallet: HOLDER });
check('MCP server redirects: not followed, 502', r.statusCode === 502 && seen.length === 1 && !leaks(r));

reset(); upstreamMode = 'error';
r = await post({ wallet: HOLDER });
check('MCP server error: status and body returned as they are', r.statusCode === 404 && JSON.parse(r.body).error.code === -32601);

// ---------------------------------------------------------------- shape of requests
reset();
r = await post({ wallet: HOLDER }, {}, Buffer.from(CALL).toString('base64'), { isBase64Encoded: true });
check('base64 body is decoded before it is passed on', seen[0].body === CALL);

reset();
r = await post({ wallet: HOLDER }, {}, 'x'.repeat(100 * 1024 + 1));
check('oversized body: 413, nothing sent', r.statusCode === 413 && seen.length === 0);

reset();
r = await handler({ requestContext: { http: { method: 'OPTIONS' } }, headers: {} });
check('OPTIONS: 204 with CORS headers', r.statusCode === 204 && r.headers['Access-Control-Allow-Origin'] === '*');
r = await handler({ requestContext: { http: { method: 'DELETE' } }, headers: {} });
check('other methods: 405', r.statusCode === 405);

// ---------------------------------------------------------------- GET: does this wallet have a pass?
reset();
r = await get({ address: HOLDER });
check('GET holder: pass true, no token, nothing sent to the MCP server', r.statusCode === 200 && JSON.parse(r.body).pass === true && !leaks(r) && seen.length === 0);
r = await get({ address: NOBODY });
check('GET no pass: pass false', r.statusCode === 200 && JSON.parse(r.body).pass === false);
r = await get({});
check('GET without an address: 400', r.statusCode === 400);
chain = 'down';
r = await get({ address: HOLDER });
check('GET when the chain cannot be read: 503', r.statusCode === 503);
reset(); env({ PASS_CONTRACT: undefined });
r = await get({ address: HOLDER });
check('GET with no contract configured: 503', r.statusCode === 503);

// ---------------------------------------------------------------- real chain (read only)
if (process.env.OFFLINE !== '1') {
  globalThis.fetch = realFetch;
  const nodes = ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com'];
  check('REAL CHAIN: the first pass holder is active', (await hasActivePass(nodes, CONTRACT, HOLDER)) === true);
  check('REAL CHAIN: an address with no pass is not active', (await hasActivePass(nodes, CONTRACT, NOBODY)) === false);
}

console.log(`\n${passed} checks passed` + (failed ? `, ${failed} FAILED` : ''));
process.exitCode = failed ? 1 : 0;
