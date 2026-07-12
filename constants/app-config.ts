import { AppIdentity, createSolanaDevnet, SolanaCluster } from '@wallet-ui/react-native-kit'

function requireDevnetUrl(url: string, label: string) {
  const normalizedUrl = url.toLowerCase()
  const mainnetSignals = ['mainnet', 'mainnet-beta', 'api.mainnet', 'solana-mainnet']

  if (mainnetSignals.some((signal) => normalizedUrl.includes(signal))) {
    throw new Error(`${label} must stay on devnet. Refusing non-devnet URL: ${url}`)
  }

  return url
}

function requireMagicBlockDevnetUrl(url: string, label: string) {
  if (!url) {
    return ''
  }

  if (!url.toLowerCase().includes('devnet')) {
    throw new Error(`${label} must stay on MagicBlock devnet. Refusing URL: ${url}`)
  }

  return url
}

export class AppConfig {
  static identity: AppIdentity = { name: 'kit-expo' }
  static devnetUsdcMint = process.env.EXPO_PUBLIC_DEVNET_USDC_MINT ?? ''
  static solanaDevnetRpcUrl = requireDevnetUrl(
    process.env.EXPO_PUBLIC_SOLANA_DEVNET_RPC_URL ??
      'https://api.devnet.solana.com',
    'EXPO_PUBLIC_SOLANA_DEVNET_RPC_URL',
  )
  static magicBlock = {
    enabled: process.env.EXPO_PUBLIC_MAGICBLOCK_ENABLED === 'true',
    erValidator:
      process.env.EXPO_PUBLIC_MAGICBLOCK_ER_VALIDATOR ??
      'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57',
    routerRpcUrl: requireMagicBlockDevnetUrl(
      process.env.EXPO_PUBLIC_MAGICBLOCK_ROUTER_RPC_URL ?? '',
      'EXPO_PUBLIC_MAGICBLOCK_ROUTER_RPC_URL',
    ),
    routerWsUrl: requireMagicBlockDevnetUrl(
      process.env.EXPO_PUBLIC_MAGICBLOCK_ROUTER_WS_URL ?? '',
      'EXPO_PUBLIC_MAGICBLOCK_ROUTER_WS_URL',
    ),
    sessionSponsorSecretKey: process.env.EXPO_PUBLIC_DEVNET_HOUSE_WALLET_SECRET_KEY ?? '',
    sessionTtlSeconds: Number(process.env.EXPO_PUBLIC_MAGICBLOCK_SESSION_TTL_SECONDS ?? 900),
  }
  static networks: SolanaCluster[] = [
    createSolanaDevnet({ url: AppConfig.solanaDevnetRpcUrl }),
  ]
}
