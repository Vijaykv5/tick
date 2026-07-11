import { AccountRole, address, type Address, type Instruction } from '@solana/kit'
import { BN, BorshInstructionCoder } from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { Buffer } from 'buffer'

import { TICK_PREDICTION_IDL } from '@/constants/tick-prediction-idl'

export const TICK_PREDICTION_PROGRAM_ID = TICK_PREDICTION_IDL.address
export const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111'
export const DEFAULT_ROUND_ID = 1n
export const DEFAULT_ROUND_DURATION_SECONDS = 60n
export const DEFAULT_PREDICTION_WINDOW_SECONDS = 30n
export const TILE_STAKE_USDC = 1
export const TILE_STAKE_BASE_UNITS = 1_000_000n
export const TILE_MULTIPLIERS_BPS = [30_000, 20_000, 12_500, 10_000, 5_000, 3_000, 2_500, 2_000, 1_500] as const
export const POOL_SEED = 'pool_v2'

const coder = new BorshInstructionCoder(TICK_PREDICTION_IDL as unknown as Idl)
const programPublicKey = new PublicKey(TICK_PREDICTION_PROGRAM_ID)

function toAddress(publicKey: PublicKey | string): Address {
  return address(publicKey.toString())
}

function roleFromWeb3Meta({ isSigner, isWritable }: { isSigner: boolean; isWritable: boolean }) {
  if (isSigner && isWritable) {
    return AccountRole.WRITABLE_SIGNER
  }

  if (isSigner) {
    return AccountRole.READONLY_SIGNER
  }

  return isWritable ? AccountRole.WRITABLE : AccountRole.READONLY
}

function meta(publicKey: PublicKey | string, role: AccountRole) {
  return { address: toAddress(publicKey), role }
}

function poolPda(symbol: string) {
  return PublicKey.findProgramAddressSync([Buffer.from(POOL_SEED), Buffer.from(symbol)], programPublicKey)[0]
}

function vaultAuthorityPda(pool: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from('vault_authority'), pool.toBuffer()], programPublicKey)[0]
}

function vaultPda(pool: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), pool.toBuffer()], programPublicKey)[0]
}

function roundIdSeed(roundId: bigint) {
  const seed = Buffer.alloc(8)
  seed.writeBigUInt64LE(roundId)
  return seed
}

function toBn(value: bigint) {
  return new BN(value.toString())
}

function roundPda(pool: PublicKey, roundId: bigint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('round'), pool.toBuffer(), roundIdSeed(roundId)],
    programPublicKey,
  )[0]
}

function predictionPda(round: PublicKey, predictor: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('prediction'), round.toBuffer(), predictor.toBuffer()],
    programPublicKey,
  )[0]
}

function userTokenAccount(ownerAddress: string, mintAddress: string) {
  return getAssociatedTokenAddressSync(new PublicKey(mintAddress), new PublicKey(ownerAddress), false, TOKEN_PROGRAM_ID)
}

function web3InstructionToKitInstruction(instruction: TransactionInstruction): Instruction {
  return {
    programAddress: toAddress(instruction.programId),
    accounts: instruction.keys.map((key) => ({
      address: toAddress(key.pubkey),
      role: roleFromWeb3Meta(key),
    })),
    data: instruction.data,
  }
}

export function getTickPredictionAddresses(
  symbol: string,
  predictorAddress: string,
  roundId = DEFAULT_ROUND_ID,
  usdcMintAddress?: string,
) {
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const predictor = new PublicKey(predictorAddress)
  const prediction = predictionPda(round, predictor)
  const vault = vaultPda(pool)
  const vaultAuthority = vaultAuthorityPda(pool)
  const predictorTokenAccount = usdcMintAddress ? userTokenAccount(predictorAddress, usdcMintAddress) : undefined

  return {
    pool: pool.toString(),
    prediction: prediction.toString(),
    predictorTokenAccount: predictorTokenAccount?.toString(),
    round: round.toString(),
    vault: vault.toString(),
    vaultAuthority: vaultAuthority.toString(),
  }
}

export function getCreateUserUsdcAccountInstruction({
  ownerAddress,
  payerAddress,
  usdcMintAddress,
}: {
  ownerAddress: string
  payerAddress: string
  usdcMintAddress: string
}): Instruction {
  return web3InstructionToKitInstruction(
    createAssociatedTokenAccountInstruction(
      new PublicKey(payerAddress),
      userTokenAccount(ownerAddress, usdcMintAddress),
      new PublicKey(ownerAddress),
      new PublicKey(usdcMintAddress),
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  )
}

export function getInitializePoolInstruction({
  authorityAddress,
  durationSeconds = DEFAULT_ROUND_DURATION_SECONDS,
  predictionWindowSeconds = DEFAULT_PREDICTION_WINDOW_SECONDS,
  symbol,
  usdcMintAddress,
}: {
  authorityAddress: string
  durationSeconds?: bigint
  predictionWindowSeconds?: bigint
  symbol: string
  usdcMintAddress: string
}): Instruction {
  const authority = new PublicKey(authorityAddress)
  const pool = poolPda(symbol)
  const vault = vaultPda(pool)
  const vaultAuthority = vaultAuthorityPda(pool)
  const usdcMint = new PublicKey(usdcMintAddress)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.WRITABLE),
      meta(vaultAuthority, AccountRole.READONLY),
      meta(vault, AccountRole.WRITABLE),
      meta(usdcMint, AccountRole.READONLY),
      meta(authority, AccountRole.WRITABLE_SIGNER),
      meta(TOKEN_PROGRAM_ID, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: coder.encode('initialize_pool', {
      duration_seconds: toBn(durationSeconds),
      prediction_window_seconds: toBn(predictionWindowSeconds),
      symbol,
    }),
  }
}

export function getOpenRoundInstruction({
  authorityAddress,
  endsAt,
  roundId,
  startPrice,
  startsAt,
  symbol,
}: {
  authorityAddress: string
  endsAt: bigint
  roundId: bigint
  startPrice: bigint
  startsAt: bigint
  symbol: string
}): Instruction {
  const authority = new PublicKey(authorityAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.WRITABLE),
      meta(round, AccountRole.WRITABLE),
      meta(authority, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: coder.encode('open_round', {
      ends_at: toBn(endsAt),
      round_id: toBn(roundId),
      start_price: toBn(startPrice),
      starts_at: toBn(startsAt),
    }),
  }
}

export function getPlaceTilePredictionInstruction({
  predictorAddress,
  roundId = DEFAULT_ROUND_ID,
  symbol,
  tileIndex,
  usdcMintAddress,
}: {
  predictorAddress: string
  roundId?: bigint
  symbol: string
  tileIndex: number
  usdcMintAddress: string
}): Instruction {
  const predictor = new PublicKey(predictorAddress)
  const usdcMint = new PublicKey(usdcMintAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const prediction = predictionPda(round, predictor)
  const vault = vaultPda(pool)
  const predictorTokenAccount = userTokenAccount(predictorAddress, usdcMintAddress)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.READONLY),
      meta(round, AccountRole.READONLY),
      meta(prediction, AccountRole.WRITABLE),
      meta(predictor, AccountRole.WRITABLE_SIGNER),
      meta(predictorTokenAccount, AccountRole.WRITABLE),
      meta(vault, AccountRole.WRITABLE),
      meta(usdcMint, AccountRole.READONLY),
      meta(TOKEN_PROGRAM_ID, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: coder.encode('place_tile_prediction', { tile_index: tileIndex }),
  }
}

export function getSettleRoundInstruction({
  authorityAddress,
  finalPrice,
  roundId,
  symbol,
}: {
  authorityAddress: string
  finalPrice: bigint
  roundId: bigint
  symbol: string
}): Instruction {
  const authority = new PublicKey(authorityAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.READONLY),
      meta(round, AccountRole.WRITABLE),
      meta(authority, AccountRole.READONLY_SIGNER),
    ],
    data: coder.encode('settle_round', { final_price: toBn(finalPrice) }),
  }
}

export function getClaimPayoutInstruction({
  claimantAddress,
  roundId,
  symbol,
  usdcMintAddress,
}: {
  claimantAddress: string
  roundId: bigint
  symbol: string
  usdcMintAddress: string
}): Instruction {
  const claimant = new PublicKey(claimantAddress)
  const usdcMint = new PublicKey(usdcMintAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const prediction = predictionPda(round, claimant)
  const vault = vaultPda(pool)
  const vaultAuthority = vaultAuthorityPda(pool)
  const claimantTokenAccount = userTokenAccount(claimantAddress, usdcMintAddress)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.READONLY),
      meta(round, AccountRole.READONLY),
      meta(prediction, AccountRole.WRITABLE),
      meta(vaultAuthority, AccountRole.READONLY),
      meta(vault, AccountRole.WRITABLE),
      meta(claimant, AccountRole.WRITABLE_SIGNER),
      meta(claimantTokenAccount, AccountRole.WRITABLE),
      meta(usdcMint, AccountRole.READONLY),
      meta(TOKEN_PROGRAM_ID, AccountRole.READONLY),
    ],
    data: coder.encode('claim_payout', {}),
  }
}
