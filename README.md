# FLASH Agent Pass

**Holding an Agent ID opens a tier of a production news service: a lane of the FLASH MCP server reserved for Agent ID holders.**

An Agent ID (`name.ai`) is the on-chain identity of a Binance Agentic Wallet. FLASH Agent Pass turns that identity into access: a wallet that holds an Agent ID claims a pass once, and its agent then reads FLASH news through a lane with its own key and its own limit, apart from the public lane that every other caller shares. The lane is built for the work agents do best: checking on a schedule, many times a day, without waiting behind everyone else.

| | |
|---|---|
| Website | https://agentic.flash.im |
| Pass contract (BNB Smart Chain) | [`0x61c712e373149cab2de86ed2aadacc568db91acb`](https://bscscan.com/address/0x61c712e373149cab2de86ed2aadacc568db91acb#code) |
| Source verification | BscScan, exact match |
| Agent ID contract (dependency) | `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` |
| FLASH MCP server, pass lane | `https://agentic.flash.im/mcp?wallet=<wallet address>` |
| FLASH MCP server, public lane | `https://api.flash.im/mcp` |
| Cost | The network fee of one transaction. FLASH charges nothing. |

## What this gives Agent ID

- **A use for Agent ID outside the chain.** The identity is not a badge here. It decides which lane an agent's calls travel in, on a news service that is already in production.
- **Better service for identified agents.** One Agent ID per user, not transferable, means passes cannot be multiplied with throwaway wallets. The pass lane has its own key and its own limit, apart from the public lane, so the public lane's traffic does not use it up.
- **News for the prediction markets agents trade.** An agent sends the question of a Polymarket or Kalshi contract and gets the stories that bear on it, each marked by how directly. In FLASH's measurement this answered more contracts, with fewer unrelated stories, than Google's search engine set over the same stories (table below).
- **Cheaper, faster, repeatable answers for agents in the ecosystem.** In FLASH's own measurement, an agent answered "what matters today" about 12 times cheaper and 13 times faster with one FLASH call than with web search, and gave the same answer each time (table below).
- **News in the user's own language, in 16 languages.** Every story is served already translated, with the same values in every language. An agent whose user reads Korean, Turkish, or Vietnamese passes the story on as it arrives and spends no tokens translating it.
- **A reason to run an agent every day.** News is a daily need. The pass lane is tuned for scheduled work, which is the kind of work that keeps an Agentic Wallet's agent in use.
- **The whole flow runs on the Agentic Wallet.** Claiming the pass is done by the user's agent, in Binance AI Pro on a phone or with the Binance Agentic Wallet skill, with a preview and the user's confirmation. Reading the news after that takes no wallet action at all: no signature and no transaction.

## What an agent can build on the pass lane

A limit of its own is what turns a news tool into a monitoring system. With the pass lane an agent can run these side by side:

| What the agent does | How | How often |
|---|---|---|
| **Breaking-news alert.** Tell the user when a top-tier story lands. | `get_latest_news` with `impact: [5]` since the last check | every 10 to 15 minutes |
| **Portfolio watch.** Follow everything the user holds or tracks. | `find_news` with up to 30 names and tickers in one call, `impact: [4, 5]` | every 10 to 15 minutes |
| **Prediction market monitor.** Follow the news behind every contract the user holds. | `find_news` with the contract's question as `sentence`, keeping stories marked `direct` | every 10 to 15 minutes |
| **Scheduled briefings.** The market's main stories, three times a day. | `get_top_news` per category, ten minutes past the hour | every 8 hours, or at the times the user chose |
| **Event triggers.** React to one kind of event, such as a regulatory action. | filter by `eventType` | with every check |
| **Sentiment tracking.** Watch how the news on one entity turns over days. | read each entity's own sentiment across stories | with every check |
| **Ranked attention.** Show only the few stories that matter most. | order by `impactScore` | with every check |
| **Tokenized stocks.** Follow the company behind the token. | `find_news` on the underlying company | every 10 to 15 minutes |
| **News behind a price move.** When a price alert fires, bring the important news on that asset from the last hour. | `find_news` with `impact: [4, 5]` and `after` | when the alert fires |
| **Section roundups.** A weekly digest of one section, such as crypto ETFs. | `get_latest_news` with `subCategory` | weekly |
| **Newsletter and social drafts.** Top stories with a cover image for each. | `get_top_news`, then `get_news_cover` per headline | daily |
| **Briefings in the user's language.** | `lang`, one of 16 languages | any of the above |

News is context for the user. The skill never uses a story to approve, delay, block, or change an order or a transfer.

## Why an agent should read FLASH instead of searching the web

What people ask an agent about the news comes down to one thing: what matters. An agent that answers with web search has to judge importance from scratch every time. It writes queries, opens articles, reads them, and decides on its own, so the answer is slow, costs more, and changes from one run to the next. FLASH has already judged every story by the same standard, so the agent gets the ranking in one call.

FLASH measured this on 6 October 2026. Claude Opus 5.5 agents were asked for "the 5 most important crypto news stories today", three times with web search alone and three times with one call to the FLASH top news tool.

| | Web search on its own | FLASH |
|---|---|---|
| Stories judged for importance | about 23 pages opened and read | all crypto stories of the last 48 hours, about 260 |
| Tool calls | about 50 (27 searches, 23 page opens) | 1 |
| Text read | about 110,000 characters | about 13,000 characters |
| Time from question to answer | about 7.7 minutes | about 36 seconds |
| Cost from question to answer (estimate) | about $1.93 | about $0.17 |
| Asked three times | only 4 of 5 stories the same, and the order changes | the same 5 stories in the same order |

About 12 times cheaper and about 13 times faster, and the same answer every time. The cost is the model and search fees the agent pays, not a FLASH fee. The same day showed the difference in judgment as well: web search put a regulator's advance notice, in which nothing had been decided, at the top in all three runs, while FLASH ranked the decisions that had actually been made above it.

Values are the median of three runs per method and include the agent writing its answer. Method and price assumptions: https://docs.flash.im/docs/for-ai-agents/mcp-server.md

For an agent that checks the news many times a day, this difference is paid on every check. That is the work the pass lane is for.

## News for prediction markets

A prediction market contract is a question, and the news that moves it rarely repeats the question's words. "Will the Fed cut rates in December?" is moved by a jobs report, a governor's speech, and an inflation print, none of which mention the contract. Keyword search misses them, and a search by meaning brings back whatever sounds similar.

FLASH covers the contracts on Polymarket and Kalshi where the volume is. An agent sends the contract's question as written and gets the stories that bear on it, each one marked:

| `relation` | What it means |
|---|---|
| `direct` | about the contract's question itself |
| `adjacent` | bears on it indirectly: the context around the question |
| `broad` | background |

An agent that manages positions keeps the `direct` stories and tells its user only when one arrives.

**Coverage.** The contracts FLASH covers carried about 93% of one-month volume on Polymarket and about 91% of volume on Kalshi, sports and entertainment aside (FLASH measurement, 2 November 2026).

**Compared with Google.** FLASH asked the same 25 contracts of FLASH and of Google's search engine (Agent Search) set over the same FLASH stories, for stories published on 27 and 28 October 2026. Every result was graded blind, without knowing which side had returned it.

| 25 contracts, two days of stories | Google Agent Search | FLASH |
|---|---|---|
| Stories returned (up to 10 per contract) | 90 | 145 |
| Stories directly about the contract's question | 48 | 64 |
| Stories unrelated to the contract | 7.8% | 4.8% |
| Contracts left with no story | 7 of 25 | 5 of 25 |

More stories on the question, fewer unrelated ones, and fewer contracts left empty. Google did well where the news repeats the contract's words, and came back empty on several "Will X happen by a date?" contracts, where it does not. This is a small sample over two days, measured by FLASH on contracts FLASH covers. It is given here because it is the comparison an agent builder would otherwise have to run.

For an agent that holds positions on several contracts, this is the job the pass lane is sized for: one check per contract, on a schedule, all running together.

## FLASH

FLASH is news intelligence infrastructure for institutions and AI agents. It reads reporting from 50 sources on crypto, the economy, politics, and geopolitics, writes each story in its own words, and analyzes it once by one standard before serving it. It handles about 10,000 stories a week and delivers them as about 160,000 stories across 16 languages.

**Binance, CryptoRank, and KuCoin use FLASH data.**

**16 languages, translated before the agent asks.** Every story is published in English first, and the other 15 languages follow shortly after. The agent sets `lang` and gets the same story, with the same values, in the language its user reads.

| | |
|---|---|
| Languages | English, 中文(简体), 中文(繁體), 한국어, 日本語, Русский, Türkçe, Deutsch, Español, Français, Tiếng Việt, ไทย, Indonesia, हिन्दी, Italiano, Português |
| `lang` | `en`, `zh-CN`, `zh-TW`, `ko`, `ja`, `ru`, `tr`, `de`, `es`, `fr`, `vi`, `th`, `id`, `hi`, `it`, `pt` |

An agent that translates each story itself pays for it in tokens on every story and every check, and may word the same story differently each time. With FLASH the translation is already done, so that cost is gone and every user of a language reads the same text.

**Built for agents to read.** A story arrives as structured JSON, not as an article to parse:

- **Importance as numbers.** Every story carries an importance tier (`impact`, 5 is the highest) and a finer score (`impactScore`, 0 to 100). An agent filters and ranks in code, without reading the text.
- **Per entity.** Each asset, company, person, or institution in a story carries its own sentiment: how the event bears on that entity.
- **Typed.** One of 18 event types (`eventType`), plus `whyItMatters`, a short reason the story is relevant.
- **Matched by entity.** A name and its ticker resolve to the same subject, and a story that only says "Fed" still matches "Federal Reserve".
- **59 sections.** Feeds narrow to sections such as crypto ETFs, earnings, central banks, and the Middle East.
- **One event, one cluster.** Reports of the same event share a `clusterId`, so an agent tells its user once.
- **Light.** The agent names the fields it wants. A scan of headlines costs about 40 tokens per story.

**Sources.** Every item names the source that reported it and links its original article.

| Group | Sources |
|---|---|
| Crypto | Cointelegraph, CoinDesk, The Block, Decrypt, CryptoSlate, Bitcoin Magazine, Beincrypto, Daily Hodl, Protos, Odaily, CryptoRank, CoinGecko |
| Business and finance | Bloomberg, Financial Times, Wall Street Journal, CNBC, Economist, Forbes, Fortune, Benzinga, TechCrunch |
| Politics and policy | Politico, The Hill, Axios, Semafor, Foreign Policy |
| General news | Reuters, AP News, New York Times, Washington Post, Guardian, BBC, CNN, Fox News, CBS News, NBC News, ABC News, MS NOW, NPR, Al Jazeera, DW, France 24, SCMP |
| Official institutions | Federal Reserve, U.S. SEC, CFTC, FDIC, OFAC, IMF, White House |

**The service is in production.**

- Website: https://flash.im
- Terminal: https://app.flash.im/terminal shows the same news live, with its structured fields.
- Documentation: https://docs.flash.im
- MCP server: `https://api.flash.im/mcp`, live since 12 October 2026. It answers without a pass and without a key, so anyone can check the quality of the news before claiming a pass.

## How Agent ID is used

| Agent ID property | How FLASH Agent Pass uses it |
|---|---|
| On-chain identity of an Agentic Wallet | **Access control.** `claim()` checks `AgentID.balanceOf(msg.sender) > 0` in the contract. A wallet without an Agent ID cannot get a pass. |
| One per user, not transferable | **One pass per wallet.** The pass is a record for the wallet that asked. It cannot be moved, bought, or sold. |
| Built for AI agents | **Claimed and used by an agent.** The user's agent prepares the claim, the user confirms it, and the same agent then reads the news through the pass lane. |
| Still held, or not | **A live check.** `isActive(wallet)` is true only while the wallet still holds its Agent ID. The gate reads it when a call arrives and keeps the answer for a few minutes, so a wallet that gives up its Agent ID leaves the pass lane. |

## Get the pass

You need an Agent ID in your Agentic Wallet, and a little BNB in that wallet for the network fee (a small fraction of a cent). FLASH charges nothing.

### With Binance AI Pro, on your phone

Nothing to install. The same two prompts are on https://agentic.flash.im with a copy button, next to a live list of the news. In the Binance App, open Binance AI and switch to AI Pro, then paste:

```
On BNB Smart Chain, call the FLASH Agent Pass contract 0x61c712e373149cab2de86ed2aadacc568db91acb from my Agentic Wallet with value 0 and input data 0x4e71d92d. This claims my FLASH Agent Pass. Show me the preview first and send it only after I confirm.
```

If AI Pro asks you to sign in to your Agentic Wallet, or to turn on Developer Mode before sending a contract call, follow its prompt. Check the preview before you confirm: the call goes to the pass contract above, the value is 0, and there is no balance change, no allowance change, and no authority change. If the preview shows anything else, do not confirm.

If the preview fails with `FlashPass: this wallet already has a pass`, the wallet has its pass. Nothing was sent.

### With your own agent

Install the skill in [`skill/flash-pass`](skill/flash-pass/SKILL.md). It uses the `baw` command from the Binance Agentic Wallet skill, previews every action, and sends nothing until the user confirms.

## Read on the pass lane

No signature and no transaction. An agent sends its MCP calls to the pass gate instead of the public address, together with the wallet address:

```
https://agentic.flash.im/mcp?wallet=<wallet address>
```

The gate reads the pass contract on BNB Smart Chain. A wallet that holds a pass reads on the pass lane. Any other call (no pass, no address, or the chain cannot be read) goes on to the same server on the public lane, so nothing is refused. The tools, arguments, and results are the same as on `https://api.flash.im/mcp`. Every answer carries two headers that say which lane the call took: `X-Flash-Lane` (`pass` or `public`) and `X-Flash-Lane-Reason`.

With Binance AI Pro, paste:

```
Read my Agentic Wallet address on BNB Smart Chain. Then use the FLASH news MCP server at https://agentic.flash.im/mcp with ?wallet= followed by that address, and tell me today's top 3 crypto news stories in the order it returns them, each with its source and impact. Also tell me which lane the call took, from the X-Flash-Lane response header.
```

AI Pro reads the wallet address itself, so there is nothing to type. It needs the Agentic Wallet to be signed in and nothing else: no Developer Mode and no confirmation, because nothing is signed or sent. The same conversation can then keep reading in plain words, for example "Tell me the top economy news from the same FLASH server."

With any other MCP client, set the server URL to the address above. A client that can send headers may send `X-Flash-Wallet: <wallet address>` instead of the query string. The skill does this for an agent that runs outside the Binance App.

**What the address proves.** Nothing about who is calling: a wallet address is public. The pass decides which lane a call takes. It is not a secret and not a login. This is a read-only news service and the same news is on the public lane, so the gate asks the wallet for nothing. A pass claimed just now shows up within a minute.

## Contract

`contracts/FlashPass.sol`, 62 lines, no dependencies.

| Function | Who | What it does |
|---|---|---|
| `claim()` | a wallet that holds an Agent ID and has no pass | records the wallet and the time, emits `PassIssued(wallet, number, time)` |
| `hasPass(address)` | anyone | true if the wallet has a pass |
| `isActive(address)` | anyone | true if the wallet has a pass and still holds an Agent ID |
| `issuedAt(address)` | anyone | when the pass was issued (unix seconds), 0 if none |
| `totalIssued()` | anyone | how many passes have been issued |
| `agentId()` | anyone | the Agent ID contract this contract reads |

### Permissions and safety

- **No owner, no admin, no upgrade, no pause.** Nothing can be changed after deployment, and nobody can remove a pass.
- **No funds.** No function is payable and there is no `receive` or `fallback`, so the contract cannot receive BNB. It never asks for a token approval and never moves tokens. There is no mint, tax, freeze, or withdraw function.
- **One external call:** the read-only `balanceOf` on the Agent ID contract. Its address is `immutable`, set once in the constructor, and the constructor refuses an address with no code.
- **No promise of returns.** The pass is an access record. It has no monetary value and is not an investment.

Compiler: Solidity 0.8.28, optimizer off, default EVM version. Deployed from the project's Agentic Wallet (`flashnews.ai`) through the shared CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`. Deployment transaction: [`0x3f4bd168a24a73a4dac468451071357c74c278386888713b4571aa4900aa5501`](https://bscscan.com/tx/0x3f4bd168a24a73a4dac468451071357c74c278386888713b4571aa4900aa5501).

## Pass gate

`gate/index.mjs` is a small function (AWS Lambda, no dependencies). It stands in front of the FLASH MCP server and has one job: choose the lane.

1. `POST https://agentic.flash.im/mcp?wallet=0x...` with an MCP call as the body. The gate reads `isActive(wallet)` from the contract and passes the call on to the MCP server: on the pass lane when the wallet holds a pass, on the public lane otherwise. The MCP server's answer comes back unchanged, with the two `X-Flash-Lane` headers added.
2. `GET https://agentic.flash.im/gate?address=0x...` answers `{"pass": true}` or `{"pass": false}` for anyone who wants to check a wallet.

The gate keeps a wallet's answer for a short time (five minutes for a pass, thirty seconds for no pass), so a run of calls reads the chain once.

What it does not do:

- It refuses no one. Without a pass the call still goes through, on the public lane.
- No login, no sessions, no QR codes, no pairing codes. It keeps no record of who asked.
- It never asks for a signature, a transaction, a token approval, a seed phrase, a private key, or an API secret.
- It passes on four request headers (`Content-Type`, `Accept`, `MCP-Protocol-Version`, `User-Agent`) and nothing else. The value that marks a pass-lane call to the MCP server stays inside the gate. It is never returned and never logged.

## Repository layout

```
contracts/FlashPass.sol    the pass contract
abi/FlashPass.abi.json     its ABI
test/simulate.cjs          19 checks of the contract against live chain state (nothing is sent)
gate/index.mjs             the pass gate
gate/test.mjs              32 checks of the gate (30 against stand-ins, 2 read the real contract)
skill/flash-pass/SKILL.md  the skill for agents
```

## Run the checks

```
npm install
npm run simulate     # contract: 19 checks against BNB Smart Chain state
npm run test:gate    # gate: 32 checks
```

`simulate` compiles the contract and asks a public node to simulate calls (`eth_simulateV1`) from wallets that really hold an Agent ID. It covers a first claim, a second claim, a wallet without an Agent ID, calls and transfers that carry BNB, unknown functions, and every read function with its expected value. It sends nothing.

## Safety

| Rule | Where this project stands |
|---|---|
| No web-based QR code login for the Agentic Wallet | No web login of any kind. The gate has no sessions. |
| No bypassing transaction confirmation | The skill and the prompts above preview first and send only after the user confirms. |
| No unauthorized asset transfers | The contract cannot receive or move assets. Every call has value 0. |
| Open source, owner permissions disclosed | Source verified on BscScan. There is no owner. |
| No collection of sensitive credentials | Nothing is asked for. The gate takes a wallet address, which is public, and asks for no signature. |
| No promise of returns | None. The pass has no monetary value. |
| Agent ID is not a tool to look up other people's wallets by name | No name lookup. The project works from the caller's own wallet. |
| No unwanted messages | FLASH does not push news. The user's own agent runs the schedule, on the topics and at the times the user chose, and says nothing when nothing is new. A pass holder is never sent news they did not ask for. |

## Risk note

Claiming a pass is a blockchain transaction that you confirm yourself and pay the network fee for. Turning on Developer Mode lets an agent sign transactions with any contract, so keep only a small balance in that wallet, read every preview, and turn Developer Mode off when you no longer need it. News is context, not advice: an impact score is not a reason that an asset is safe, recommended, or certain to move. Trading carries risk of loss.

## License

MIT
