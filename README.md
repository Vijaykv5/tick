<p align="center">
  <img src="assets/images/logo.png" alt="Tick logo" width="128" height="128" />
</p>

<h1 align="center">Tick</h1>

<p align="center">
  Fast mobile prediction markets on Solana devnet, powered by Anchor and MagicBlock Ephemeral Rollups.
</p>

Tick is a mobile-first Solana prediction market app built with Expo, React Native, Solana Kit, Anchor, SPL Token, and MagicBlock Ephemeral Rollups.

Users pick a crypto market, press **Predict** once to prepare a reusable fast prediction session, then tap a settlement tile during the prediction window. USDC staking and payout settlement stay on Solana devnet, while fast tile selection can run through MagicBlock ER when enabled.

## Project Status

- Network: Solana devnet
- App: Expo React Native Android app
- Program framework: Anchor
- Fast execution layer: MagicBlock Ephemeral Rollups
- Token used for staking: devnet USDC-compatible SPL token with 6 decimals
- Android package: `com.vijay.tick`

## Important Addresses

| Name                          | Address                                        |
| ----------------------------- | ---------------------------------------------- |
| Tick Prediction Program       | `4gaZzuoNzEWUtRnLSFeHABQTn2hPxKy3V5qeVsUSYaJz` |
| MagicBlock ER Validator       | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`  |
| MagicBlock Delegation Program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| SPL Token Program             | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`  |

Program source:

- [programs/tick_prediction/src/lib.rs](programs/tick_prediction/src/lib.rs)

Client instruction builders:

- [features/tick-prediction/tick-prediction-client.ts](features/tick-prediction/tick-prediction-client.ts)

IDL:

- [constants/tick-prediction-idl.ts](constants/tick-prediction-idl.ts)

## Explorer

Devnet explorer link for the Tick Prediction program:

```txt
https://explorer.solana.com/address/4gaZzuoNzEWUtRnLSFeHABQTn2hPxKy3V5qeVsUSYaJz?cluster=devnet
```

## How It Works

1. A supported market pool is initialized for `BTC`, `SOL`, or `ETH`.
2. Each round opens with a start price, duration, and prediction window.
3. The user presses **Predict** to authorize and fund a reusable session.
4. The user taps a tile during the prediction window.
5. The tile selection is written through the fast path when MagicBlock is enabled.
6. ER state is committed back to Solana before settlement and payout.
7. Winning predictions can claim USDC payout from the pool vault.

The v1 design keeps USDC custody and final settlement on Solana devnet. MagicBlock is used for fast round/prediction state, not for holding custody funds.

## Markets

The app currently supports:

| Symbol | Market                    |
| ------ | ------------------------- |
| `BTC`  | Bitcoin prediction round  |
| `SOL`  | Solana prediction round   |
| `ETH`  | Ethereum prediction round |

Each prediction uses a 1 USDC stake:

```txt
1_000_000 base units, 6 decimals
```

## Environment Variables

Create a `.env` file in the project root.

```bash
EXPO_PUBLIC_SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com
EXPO_PUBLIC_DEVNET_USDC_MINT=<your-devnet-usdc-mint>

EXPO_PUBLIC_MAGICBLOCK_ENABLED=true
EXPO_PUBLIC_MAGICBLOCK_ROUTER_RPC_URL=https://devnet-router.magicblock.app
EXPO_PUBLIC_MAGICBLOCK_ROUTER_WS_URL=wss://devnet-router.magicblock.app
EXPO_PUBLIC_MAGICBLOCK_ER_VALIDATOR=MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57
EXPO_PUBLIC_MAGICBLOCK_SESSION_TTL_SECONDS=900

EXPO_PUBLIC_DEVNET_HOUSE_WALLET_SECRET_KEY=<devnet-only-session-sponsor-key>
```

Important:

- Keep every RPC and router URL on devnet.
- Do not use a mainnet wallet key in this project.
- `EXPO_PUBLIC_*` values are bundled into the client. Treat the house wallet as devnet-only and disposable.

## Local Development

Install dependencies:

```bash
bun install
```

Start Expo:

```bash
bun run dev
```

Run on a connected Android device:

```bash
bun run android --device
```

Check connected devices:

```bash
adb devices
```

## APK Install

A local debug APK is generated at:

```txt
android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a connected Android phone:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

If Android says the package conflicts with an existing app, either uninstall the old app first or rebuild after changing `expo.android.package` in [app.json](app.json).

## EAS Build

Log in:

```bash
bunx eas-cli login
```

Build Android:

```bash
bunx eas-cli build -p android --profile preview
```

EAS project id:

```txt
f2c3bb64-30c3-4d14-a979-e2210ea02b07
```

## Program Development

Run Anchor tests:

```bash
bun run anchor:test
```

Format:

```bash
bun run format
```

Typecheck:

```bash
bun run tsc --noEmit
```

Lint:

```bash
bun run lint:check
```

## Main Program Instructions

The Anchor program includes instructions for:

- `initialize_pool`
- `open_round`
- `authorize_pool_session`
- `open_round_with_session`
- `place_tile_prediction`
- `fund_prediction`
- `select_tile_on_er`
- `delegate_round`
- `delegate_prediction`
- `commit_round`
- `commit_prediction`
- `undelegate_round`
- `undelegate_prediction`
- `settle_round`
- `claim_payout`

## Repository Structure

```txt
app/                                  Expo Router screens
assets/                               App logo, market logos, fonts, sounds
constants/                            App config, styles, generated IDL
features/prices/                      Market price fetching and fallback feeds
features/tick-prediction/             Solana instruction builders and PDA helpers
programs/tick_prediction/             Anchor program
tests/                                Anchor test suite
vendor/ephemeral-rollups-sdk/         Vendored MagicBlock ER SDK
```

## Notes

- The app is intentionally configured for devnet-only usage.
- Mainnet URLs are rejected by app config guards.
