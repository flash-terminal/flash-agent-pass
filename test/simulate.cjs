// Checks FlashPass against live BNB Smart Chain state, without sending anything.
//
// It asks a public node to simulate calls (eth_simulateV1) from wallets that really
// hold an Agent ID, with the compiled contract placed at a scratch address. Nothing is
// signed or broadcast, and the wallets used are only named as the "from" of a simulation.
//
// Run: npm install && npm run simulate
const fs = require("fs"), path = require("path"), solc = require("solc");
const RPCS = ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc.drpc.org"];
const AGENT_ID = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";
const PASS = "0xf1a5000000000000000000000000000000000001";
const NON = "0x1111111111111111111111111111111111111111";
const X = "0x2222222222222222222222222222222222222222";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
let id = 0;
async function rpc(method, params, url = RPCS[0]) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json();
  if (j.error) { const e = new Error(JSON.stringify(j.error).slice(0, 300)); e.data = j.error.data; throw e; }
  return j.result;
}
const pad = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
function reason(d) {
  if (!d || d === "0x") return "(no reason)";
  if (d.startsWith("0x08c379a0")) {
    const b = Buffer.from(d.slice(10), "hex");
    const n = Number(BigInt("0x" + b.subarray(32, 64).toString("hex")));
    return b.subarray(64, 64 + n).toString();
  }
  return d.slice(0, 20);
}

function compile() {
  const src = {
    "FlashPass.sol": { content: fs.readFileSync(path.join(__dirname, "..", "contracts", "FlashPass.sol"), "utf8") },
  };
  const input = { language: "Solidity", sources: src, settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.methodIdentifiers"] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = out.errors || [];
  for (const e of errs) console.log("compiler", e.severity, e.formattedMessage.split("\n")[0]);
  if (errs.some((e) => e.severity === "error")) process.exit(1);
  return { P: out.contracts["FlashPass.sol"].FlashPass };
}

(async () => {
  const { P } = compile();
  const sel = P.evm.methodIdentifiers;
  console.log("compiler", solc.version(), "| settings: default (optimizer off)");
  console.log("FlashPass creation bytes", P.evm.bytecode.object.length / 2, "| functions", Object.keys(sel).join(", "));
  fs.writeFileSync(path.join(__dirname, "..", "abi", "FlashPass.abi.json"), JSON.stringify(P.abi, null, 1));

  const head = parseInt(await rpc("eth_blockNumber", []), 16);
  const gasPrice = BigInt(await rpc("eth_gasPrice", []));
  console.log("chain", parseInt(await rpc("eth_chainId", []), 16), "| block", head, "| gas price (gwei)", Number(gasPrice) / 1e9);

  // real holders: wallets that received an Agent ID recently. Looks back in steps until 4 are found.
  const STEP = 5000, MAX_STEPS = 40;
  const hex = (n) => "0x" + n.toString(16);
  const seen = new Set(), H = [];
  let searched = 0;
  for (let to = head; H.length < 4 && searched < STEP * MAX_STEPS && to > STEP; to -= STEP, searched += STEP) {
    const logs = await rpc("eth_getLogs", [{ address: AGENT_ID, fromBlock: hex(to - STEP + 1), toBlock: hex(to), topics: [TRANSFER] }]);
    for (const a of logs.map((l) => "0x" + l.topics[2].slice(26))) {
      if (seen.has(a)) continue;
      seen.add(a);
      const bal = BigInt(await rpc("eth_call", [{ to: AGENT_ID, data: "0x70a08231" + pad(a) }, "latest"]));
      const code = await rpc("eth_getCode", [a, "latest"]);
      if (bal > 0n && code === "0x") H.push(a);
      if (H.length === 4) break;
    }
  }
  console.log("real Agent ID wallets used:", H.length, "(from", seen.size, "checked, looking back", searched, "blocks)");
  if (H.length < 4) { console.log("need 4 holders, stop"); process.exit(1); }
  const nonBal = BigInt(await rpc("eth_call", [{ to: AGENT_ID, data: "0x70a08231" + pad(NON) }, "latest"]));
  console.log("non-holder Agent ID balance:", nonBal.toString());

  // deployment: run the constructor, take the code that would be stored
  const runtime = await rpc("eth_call", [{ from: X, data: "0x" + P.evm.bytecode.object + pad(AGENT_ID) }, "latest"]);
  console.log("deploy simulated | stored code bytes", (runtime.length - 2) / 2);
  let badDeploy = "deployed (unexpected)";
  try { await rpc("eth_call", [{ from: X, data: "0x" + P.evm.bytecode.object + pad(NON) }, "latest"]); }
  catch (e) { badDeploy = "refused: " + reason(e.data); }
  console.log("deploy with a wrong Agent ID address ->", badDeploy);

  const c = (from, to, data, value) => ({ from, to, data: data || "0x", ...(value ? { value: "0x" + value.toString(16) } : {}) });
  const V = 10n ** 13n; // 0.00001 BNB
  const calls = [
    ["holder 1 asks for a pass (claim)", c(H[0], PASS, "0x" + sel["claim()"]), "ok"],
    ["holder 1 asks again", c(H[0], PASS, "0x" + sel["claim()"]), "revert"],
    ["wallet without Agent ID asks", c(NON, PASS, "0x" + sel["claim()"]), "revert"],
    ["holder 2 sends 0.00001 BNB (plain transfer)", c(H[1], PASS, "0x", V), "revert"],
    ["holder 2 then calls claim", c(H[1], PASS, "0x" + sel["claim()"]), "ok"],
    ["holder 1 calls claim with BNB attached", c(H[0], PASS, "0x" + sel["claim()"], 1n), "revert"],
    ["wallet without Agent ID sends BNB", c(NON, PASS, "0x", V), "revert"],
    ["holder 3 sends an empty call with 0 BNB", c(H[2], PASS, "0x"), "revert"],
    ["read hasPass(holder 3) after the refused calls", c(X, PASS, "0x" + sel["hasPass(address)"] + pad(H[2])), "ok", 0n],
    ["unknown function", c(H[0], PASS, "0xdeadbeef"), "revert"],
    ["unknown function with BNB attached", c(H[0], PASS, "0xdeadbeef", V), "revert"],
    ["holder 4 asks for a pass (claim)", c(H[3], PASS, "0x" + sel["claim()"]), "ok"],
    ["read totalIssued", c(X, PASS, "0x" + sel["totalIssued()"]), "ok", 3n],
    ["read hasPass(holder 1)", c(X, PASS, "0x" + sel["hasPass(address)"] + pad(H[0])), "ok", 1n],
    ["read hasPass(non-holder)", c(X, PASS, "0x" + sel["hasPass(address)"] + pad(NON)), "ok", 0n],
    ["read isActive(holder 2)", c(X, PASS, "0x" + sel["isActive(address)"] + pad(H[1])), "ok", 1n],
    ["read isActive(holder 3, no pass)", c(X, PASS, "0x" + sel["isActive(address)"] + pad(H[2])), "ok", 0n],
    ["read issuedAt(holder 4)", c(X, PASS, "0x" + sel["issuedAt(address)"] + pad(H[3])), "ok"],
    ["read agentId", c(X, PASS, "0x" + sel["agentId()"]), "ok", BigInt(AGENT_ID)],
  ];
  const rich = "0x" + (10n ** 18n).toString(16);
  // Every sender gets a simulated balance, so the outcome does not depend on what the real wallets hold.
  const over = { [PASS]: { code: runtime }, [X]: { balance: rich }, [NON]: { balance: rich } };
  for (const h of H) over[h] = { balance: rich };
  let res = null, used = null;
  for (const url of RPCS) {
    try {
      res = await rpc("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: over, calls: calls.map((x) => x[1]) }], traceTransfers: true, validation: false }, "latest"], url);
      used = url; break;
    } catch (e) { console.log("eth_simulateV1 not available at", url, "|", String(e.message).slice(0, 110)); }
  }
  if (!res) { console.log("NO_SIMULATE"); process.exit(2); }
  console.log("sequence simulated at", used, "on block", parseInt(res[0].number, 16));
  let pass = 0;
  res[0].calls.forEach((r, i) => {
    const label = calls[i][0], want = calls[i][2];
    const ok = r.status === "0x1";
    const exp = calls[i][3];
    const good = ok === (want === "ok") && (exp === undefined || (ok && BigInt(r.returnData) === exp)); pass += good ? 1 : 0;
    const ev = (r.logs || []).filter((l) => l.address.toLowerCase() === PASS).map((l) => "PassIssued(wallet=0x" + l.topics[1].slice(26, 34) + ".., number=" + BigInt(l.topics[2]) + ")");
    const mv = (r.logs || []).filter((l) => l.address.toLowerCase() === NATIVE).map((l) => "0x" + l.topics[1].slice(26, 32) + "->0x" + l.topics[2].slice(26, 32) + " " + BigInt(l.data));
    let detail;
    if (!ok) detail = "refused: " + reason(r.error && r.error.data ? r.error.data : r.returnData);
    else if (label.startsWith("read")) detail = "= " + BigInt(r.returnData).toString(r.returnData.length > 40 && label.includes("agentId") ? 16 : 10);
    else detail = "gas " + parseInt(r.gasUsed, 16);
    console.log(good ? "PASS" : "FAIL", "|", String(i + 1).padStart(2), label, "|", ok ? "ok" : "reverted", "|", detail, ev.length ? "| " + ev.join(" ") : "", mv.length ? "| BNB moves: " + mv.join(", ") : "");
  });
  console.log("result:", pass, "of", calls.length, "as expected");
  const g = res[0].calls.map((r) => parseInt(r.gasUsed, 16));
  const fee = (n) => (Number(BigInt(n) * gasPrice) / 1e18).toFixed(8);
  const bal1 = Number(BigInt(await rpc("eth_getBalance", [H[0], "latest"]))) / 1e18;
  console.log("fee at current gas price | claim:", fee(g[0]), "BNB | holder 1 holds", bal1.toFixed(8), "BNB");
  try {
    const dg = parseInt(await rpc("eth_estimateGas", [{ from: X, data: "0x" + P.evm.bytecode.object + pad(AGENT_ID) }, "latest", { [X]: { balance: rich } }]), 16);
    console.log("deployment gas", dg, "| fee", fee(dg), "BNB");
  } catch (e) { console.log("deployment gas estimate ERR", String(e.message).slice(0, 140)); }
})();
