// Local test for the pass gate. Run: node test.mjs
// Signatures here are real: made with throwaway keys by a second, independent path
// (the JSON string the gate hands out is parsed and signed as a wallet would).
import assert from 'node:assert/strict';
import { Wallet, TypedDataEncoder } from 'ethers';
import { handler } from './index.mjs';

const realFetch = globalThis.fetch;
const CONTRACT = '0xF1a5000000000000000000000000000000000001';
const TOKEN = 'fp_local_test_token';
const WORD = (n) => '0x' + n.toString(16).padStart(64, '0');
const holder = Wallet.createRandom();
const other = Wallet.createRandom();

let calls = [];
let passHolders = new Set([holder.address.toLowerCase()]);
let nodeDown = false;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push(String(url));
  if (nodeDown) throw new Error('down');
  const asked = '0x' + body.params[0].data.slice(-40);
  return new Response(JSON.stringify({ result: WORD(passHolders.has(asked) ? 1 : 0) }), { status: 200 });
};

const get = (address) => ({ requestContext: { http: { method: 'GET' } }, queryStringParameters: address === undefined ? undefined : { address } });
const post = (obj) => ({ requestContext: { http: { method: 'POST' } }, body: typeof obj === 'string' ? obj : JSON.stringify(obj) });
const read = async (event) => { const r = await handler(event); return { status: r.statusCode, body: JSON.parse(r.body), raw: r.body }; };

/** Signs exactly what the gate handed out, the way a wallet would: from the JSON string. */
async function signAsWallet(signRequest, wallet) {
  const req = JSON.parse(signRequest);
  assert.equal(req.method, 'eth_signTypedData_v4');
  const typed = JSON.parse(req.params[1]);
  const { EIP712Domain, ...types } = typed.types;
  assert.ok(Array.isArray(EIP712Domain));
  assert.equal(TypedDataEncoder.getPrimaryType(types), typed.primaryType);
  return { signer: req.params[0], typed, signature: await wallet.signTypedData(typed.domain, types, typed.message) };
}

let passed = 0;
const check = async (name, fn) => { calls = []; nodeDown = false; await fn(); passed += 1; console.log('PASS |', name); };

process.env.PASS_CONTRACT = CONTRACT;
process.env.MCP_PASS_TOKEN = TOKEN;

let step1;
await check('step 1: a wallet with a pass gets a sign request and no token', async () => {
  step1 = await read(get(holder.address));
  assert.equal(step1.status, 200);
  assert.equal(step1.body.pass, true);
  assert.ok(!step1.raw.includes(TOKEN));
  assert.equal(step1.body.mcp, undefined);
  const { signer, typed } = await signAsWallet(step1.body.signRequest, holder);
  assert.equal(signer, holder.address.toLowerCase());
  assert.equal(typed.message.wallet, holder.address.toLowerCase());
  assert.equal(typed.message.expires, step1.body.expires);
  assert.equal(typed.domain.chainId, 56);
  assert.equal(typed.domain.verifyingContract, CONTRACT.toLowerCase());
});

let good;
await check('step 2: the wallet signs and gets the lane token', async () => {
  good = await signAsWallet(step1.body.signRequest, holder);
  const r = await read(post({ address: holder.address, expires: step1.body.expires, signature: good.signature }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { pass: true, mcp: { url: 'https://api.flash.im/mcp', header: 'Authorization', value: `Bearer ${TOKEN}` } });
});

await check('an address alone never returns the token', async () => {
  const a = await read(get(holder.address));
  const b = await read(post({ address: holder.address }));
  assert.ok(!a.raw.includes(TOKEN));
  assert.equal(b.status, 400);
  assert.ok(!b.raw.includes(TOKEN));
});

await check('someone else signing for the holder address is refused', async () => {
  const forged = await signAsWallet(step1.body.signRequest, other);
  const r = await read(post({ address: holder.address, expires: step1.body.expires, signature: forged.signature }));
  assert.equal(r.status, 401);
  assert.ok(!r.raw.includes(TOKEN));
  assert.equal(calls.length, 0); // refused before the chain is read
});

await check('a holder signature reused for another address is refused', async () => {
  const r = await read(post({ address: other.address, expires: step1.body.expires, signature: good.signature }));
  assert.equal(r.status, 401);
});

await check('a signature with a changed expires is refused', async () => {
  const r = await read(post({ address: holder.address, expires: step1.body.expires - 1, signature: good.signature }));
  assert.equal(r.status, 401);
});

await check('a signature made 6 days ago for the full window is still accepted, and the chain is read again', async () => {
  const exp = Math.floor(Date.now() / 1000) + 86400; // issued 6 days ago with a 7-day window
  const sig = await holder.signTypedData(good.typed.domain, { PassCheck: good.typed.types.PassCheck }, { ...good.typed.message, expires: exp });
  const r = await read(post({ address: holder.address, expires: exp, signature: sig }));
  assert.equal(r.status, 200);
  assert.equal(r.body.pass, true);
  assert.equal(calls.length, 1);
});

await check('an expired signature is refused', async () => {
  const past = Math.floor(Date.now() / 1000) - 5;
  const sig = await holder.signTypedData(good.typed.domain, { PassCheck: good.typed.types.PassCheck }, { ...good.typed.message, expires: past });
  const r = await read(post({ address: holder.address, expires: past, signature: sig }));
  assert.equal(r.status, 401);
  assert.match(r.body.error, /expired/);
});

await check('a signature dated far ahead is refused (cannot be made long-lived)', async () => {
  const far = Math.floor(Date.now() / 1000) + 8 * 86400; // the window is 7 days
  const sig = await holder.signTypedData(good.typed.domain, { PassCheck: good.typed.types.PassCheck }, { ...good.typed.message, expires: far });
  const r = await read(post({ address: holder.address, expires: far, signature: sig }));
  assert.equal(r.status, 400);
  assert.ok(!r.raw.includes(TOKEN));
});

await check('a signature for another contract (another domain) is refused', async () => {
  const sig = await holder.signTypedData({ ...good.typed.domain, verifyingContract: '0x' + '9'.repeat(40) }, { PassCheck: good.typed.types.PassCheck }, good.typed.message);
  const r = await read(post({ address: holder.address, expires: step1.body.expires, signature: sig }));
  assert.equal(r.status, 401);
});

await check('a signature for another purpose text is refused', async () => {
  const sig = await holder.signTypedData(good.typed.domain, { PassCheck: good.typed.types.PassCheck }, { ...good.typed.message, purpose: 'Something else' });
  const r = await read(post({ address: holder.address, expires: step1.body.expires, signature: sig }));
  assert.equal(r.status, 401);
});

await check('a valid signature from a wallet without a pass gets no token', async () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const sig = await other.signTypedData(good.typed.domain, { PassCheck: good.typed.types.PassCheck }, { wallet: other.address.toLowerCase(), purpose: good.typed.message.purpose, expires: exp });
  const r = await read(post({ address: other.address, expires: exp, signature: sig }));
  assert.equal(r.status, 200);
  assert.equal(r.body.pass, false);
  assert.ok(!r.raw.includes(TOKEN));
});

await check('the pass is checked again at step 2 (pass gone after signing: no token)', async () => {
  passHolders = new Set();
  const r = await read(post({ address: holder.address, expires: step1.body.expires, signature: good.signature }));
  assert.equal(r.body.pass, false);
  assert.ok(!r.raw.includes(TOKEN));
  passHolders = new Set([holder.address.toLowerCase()]);
});

await check('the address in any letter case works with the same signature', async () => {
  assert.equal((await read(post({ address: holder.address.toUpperCase().replace('0X', '0x'), expires: step1.body.expires, signature: good.signature }))).body.pass, true);
  const r = await read(post({ address: holder.address.toLowerCase(), expires: step1.body.expires, signature: good.signature }));
  assert.equal(r.body.pass, true);
});

await check('the signature in the shape the Agentic Wallet returns (r+s without 0x, recovery apart) works', async () => {
  const raw = good.signature.slice(2);
  const rs = raw.slice(0, 128);
  const v = raw.slice(128); // 1b or 1c
  const parity = v === '1b' ? '00' : '01';
  for (const [signature, signatureRecovery] of [[rs, parity], [rs.toUpperCase(), parity], ['0x' + rs, v], [raw, undefined]]) {
    const r = await read(post({ address: holder.address, expires: step1.body.expires, signature, signatureRecovery }));
    assert.equal(r.status, 200);
    assert.equal(r.body.pass, true);
  }
  // the wrong recovery value must not pass
  const wrong = await read(post({ address: holder.address, expires: step1.body.expires, signature: rs, signatureRecovery: parity === '00' ? '01' : '00' }));
  assert.equal(wrong.status, 401);
  // r+s alone, or a recovery value that is not one, is malformed
  assert.equal((await read(post({ address: holder.address, expires: step1.body.expires, signature: rs }))).status, 400);
  assert.equal((await read(post({ address: holder.address, expires: step1.body.expires, signature: rs, signatureRecovery: '05' }))).status, 400);
});

await check('step 1 for a wallet without a pass: no sign request', async () => {
  const r = await read(get(other.address));
  assert.equal(r.body.pass, false);
  assert.equal(r.body.signRequest, undefined);
});

for (const [name, event, status] of [
  ['GET without address', get(undefined), 400],
  ['GET with a name', get('someone.ai'), 400],
  ['POST that is not JSON', post('address=x'), 400],
  ['POST with a malformed signature', post({ address: holder.address, expires: 1, signature: '0x1234' }), 400],
  ['POST with a non-number expires', post({ address: holder.address, expires: 'soon', signature: '0x' + 'a'.repeat(130) }), 400],
  ['POST with a well-formed but meaningless signature', post({ address: holder.address, expires: Math.floor(Date.now() / 1000) + 60, signature: '0x' + 'a'.repeat(130) }), 401],
  ['DELETE', { requestContext: { http: { method: 'DELETE' } } }, 405],
]) {
  await check(`bad input is refused without reading the chain (${name})`, async () => {
    const r = await read(event);
    assert.equal(r.status, status);
    assert.equal(calls.length, 0);
    assert.ok(!r.raw.includes(TOKEN));
  });
}

await check('chain unreadable: 503 at both steps, no token', async () => {
  nodeDown = true;
  assert.equal((await read(get(holder.address))).status, 503);
  nodeDown = true;
  const r = await read(post({ address: holder.address, expires: step1.body.expires, signature: good.signature }));
  assert.equal(r.status, 503);
  assert.ok(!r.raw.includes(TOKEN));
});

for (const [name, setup] of [
  ['no contract address', () => { delete process.env.PASS_CONTRACT; }],
  ['no token', () => { process.env.PASS_CONTRACT = CONTRACT; delete process.env.MCP_PASS_TOKEN; }],
]) {
  await check(`not configured: closed at both steps (${name})`, async () => {
    setup();
    assert.equal((await read(get(holder.address))).status, 503);
    assert.equal((await read(post({ address: holder.address, expires: step1.body.expires, signature: good.signature }))).status, 503);
    assert.equal(calls.length, 0);
  });
}
process.env.PASS_CONTRACT = CONTRACT;
process.env.MCP_PASS_TOKEN = TOKEN;

globalThis.fetch = realFetch;
await check('REAL CHAIN: nothing deployed at the contract address gives 503', async () => {
  assert.equal((await read(get(holder.address))).status, 503);
});

console.log(`\n${passed} checks passed`);
