import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { getAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { createRequire } from 'module'

import type { TickPrediction } from '../target/types/tick_prediction'

const require = createRequire(import.meta.url)
const BN = require('bn.js')
const USDC_MINT = new anchor.web3.PublicKey(process.env.EXPO_PUBLIC_DEVNET_USDC_MINT ?? '')
const SYMBOLS = ['BTC', 'SOL', 'ETH'] as const
const HOUSE_LIQUIDITY = 1_000_000_000

function poolPda(symbol: string, programId: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('pool_v2'), Buffer.from(symbol)], programId)[0]
}

function vaultAuthorityPda(pool: anchor.web3.PublicKey, programId: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault_authority'), pool.toBuffer()], programId)[0]
}

function vaultPda(pool: anchor.web3.PublicKey, programId: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('vault'), pool.toBuffer()], programId)[0]
}

async function main() {
  if (!process.env.EXPO_PUBLIC_DEVNET_USDC_MINT) {
    throw new Error('EXPO_PUBLIC_DEVNET_USDC_MINT is required')
  }

  anchor.setProvider(anchor.AnchorProvider.env())

  const provider = anchor.getProvider() as anchor.AnchorProvider
  const program = anchor.workspace.tickPrediction as Program<TickPrediction>
  const payer = provider.wallet as anchor.Wallet

  for (const symbol of SYMBOLS) {
    const pool = poolPda(symbol, program.programId)
    const vaultAuthority = vaultAuthorityPda(pool, program.programId)
    const vault = vaultPda(pool, program.programId)
    const poolInfo = await provider.connection.getAccountInfo(pool)

    if (!poolInfo) {
      await program.methods
        .initializePool(symbol, new BN(60), new BN(30))
        .accounts({
          authority: provider.publicKey,
          pool,
          vault,
          vaultAuthority,
          usdcMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as never)
        .rpc()
    }

    const vaultAccount = await getAccount(provider.connection, vault)

    if (vaultAccount.amount < BigInt(HOUSE_LIQUIDITY)) {
      await mintTo(provider.connection, payer.payer, USDC_MINT, vault, provider.publicKey, HOUSE_LIQUIDITY)
    }

    const fundedVault = await getAccount(provider.connection, vault)
    console.log(`${symbol} pool ${pool.toBase58()} vault ${vault.toBase58()} balance ${fundedVault.amount.toString()}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
