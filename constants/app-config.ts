import { AppIdentity, createSolanaDevnet, SolanaCluster } from '@wallet-ui/react-native-kit'

export class AppConfig {
  static identity: AppIdentity = { name: 'kit-expo' }
  static devnetUsdcMint = process.env.EXPO_PUBLIC_DEVNET_USDC_MINT ?? ''
  static solanaDevnetRpcUrl =
    process.env.EXPO_PUBLIC_SOLANA_DEVNET_RPC_URL ??
    'https://api.devnet.solana.com'
  static magicBlock = {
    erRpcUrl: process.env.EXPO_PUBLIC_MAGICBLOCK_ER_RPC_URL ?? '',
    sessionTtlSeconds: Number(process.env.EXPO_PUBLIC_MAGICBLOCK_SESSION_TTL_SECONDS ?? 900),
  }
  static networks: SolanaCluster[] = [
    createSolanaDevnet({ url: AppConfig.solanaDevnetRpcUrl }),
  ]
}
