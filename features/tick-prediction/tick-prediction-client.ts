import { AccountRole, address, type Address, type Instruction } from '@solana/kit'
import { BN, BorshInstructionCoder } from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
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
export const TILE_MULTIPLIERS_BPS = [3_000, 2_000, 1_250, 1_000, 500, 300, 250, 200, 150] as const
export const POOL_SEED = 'pool_v2'
export const DEFAULT_MAGICBLOCK_ER_VALIDATOR = 'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57'
export const MAGICBLOCK_DELEGATION_PROGRAM_ID = 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh'
export const MAGICBLOCK_MAGIC_PROGRAM_ID = 'Magic11111111111111111111111111111111111111'
export const MAGICBLOCK_MAGIC_CONTEXT_ID = 'MagicContext1111111111111111111111111111111'

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

function poolSessionPda(pool: PublicKey, authority: PublicKey, sessionAuthority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool_session'), pool.toBuffer(), authority.toBuffer(), sessionAuthority.toBuffer()],
    programPublicKey,
  )[0]
}

function delegateBufferPda(delegatedAccount: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('buffer'), delegatedAccount.toBuffer()],
    programPublicKey,
  )[0]
}

function delegationRecordPda(delegatedAccount: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('delegation'), delegatedAccount.toBuffer()],
    new PublicKey(MAGICBLOCK_DELEGATION_PROGRAM_ID),
  )[0]
}

function delegationMetadataPda(delegatedAccount: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('delegation-metadata'), delegatedAccount.toBuffer()],
    new PublicKey(MAGICBLOCK_DELEGATION_PROGRAM_ID),
  )[0]
}

function userTokenAccount(ownerAddress: string, mintAddress: string) {
  return getAssociatedTokenAddressSync(new PublicKey(mintAddress), new PublicKey(ownerAddress), false, TOKEN_PROGRAM_ID)
}

export function getUserTokenAccountAddress(ownerAddress: string, mintAddress: string) {
  return userTokenAccount(ownerAddress, mintAddress).toString()
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

export function kitInstructionToWeb3Instruction(instruction: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys:
      instruction.accounts?.map((account) => ({
        pubkey: new PublicKey(account.address),
        isSigner:
          account.role === AccountRole.READONLY_SIGNER || account.role === AccountRole.WRITABLE_SIGNER,
        isWritable:
          account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER,
      })) ?? [],
    data: Buffer.from(instruction.data ?? []),
  })
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

export function getTransferLamportsInstruction({
  fromAddress,
  lamports,
  toAddress,
}: {
  fromAddress: string
  lamports: number | bigint
  toAddress: string
}): Instruction {
  return web3InstructionToKitInstruction(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(fromAddress),
      lamports,
      toPubkey: new PublicKey(toAddress),
    }),
  )
}

export function getTransferUsdcInstruction({
  amount,
  authorityAddress,
  destinationOwnerAddress,
  sourceOwnerAddress,
  usdcMintAddress,
}: {
  amount: bigint
  authorityAddress: string
  destinationOwnerAddress: string
  sourceOwnerAddress: string
  usdcMintAddress: string
}): Instruction {
  const usdcMint = new PublicKey(usdcMintAddress)

  return web3InstructionToKitInstruction(
    createTransferCheckedInstruction(
      userTokenAccount(sourceOwnerAddress, usdcMintAddress),
      usdcMint,
      userTokenAccount(destinationOwnerAddress, usdcMintAddress),
      new PublicKey(authorityAddress),
      amount,
      6,
      [],
      TOKEN_PROGRAM_ID,
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

export function getAuthorizePoolSessionInstruction({
  authorityAddress,
  expiresAt,
  sessionAuthorityAddress,
  symbol,
}: {
  authorityAddress: string
  expiresAt: bigint
  sessionAuthorityAddress: string
  symbol: string
}): Instruction {
  const authority = new PublicKey(authorityAddress)
  const sessionAuthority = new PublicKey(sessionAuthorityAddress)
  const pool = poolPda(symbol)
  const poolSession = poolSessionPda(pool, authority, sessionAuthority)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.READONLY),
      meta(poolSession, AccountRole.WRITABLE),
      meta(authority, AccountRole.WRITABLE_SIGNER),
      meta(sessionAuthority, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: coder.encode('authorize_pool_session', { expires_at: toBn(expiresAt) }),
  }
}

export function getOpenRoundWithSessionInstruction({
  authorityAddress,
  endsAt,
  roundId,
  sessionAuthorityAddress,
  startPrice,
  startsAt,
  symbol,
}: {
  authorityAddress: string
  endsAt: bigint
  roundId: bigint
  sessionAuthorityAddress: string
  startPrice: bigint
  startsAt: bigint
  symbol: string
}): Instruction {
  const authority = new PublicKey(authorityAddress)
  const sessionAuthority = new PublicKey(sessionAuthorityAddress)
  const pool = poolPda(symbol)
  const poolSession = poolSessionPda(pool, authority, sessionAuthority)
  const round = roundPda(pool, roundId)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.READONLY),
      meta(poolSession, AccountRole.READONLY),
      meta(authority, AccountRole.READONLY),
      meta(sessionAuthority, AccountRole.WRITABLE_SIGNER),
      meta(round, AccountRole.WRITABLE),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: coder.encode('open_round_with_session', {
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

export function getFundPredictionInstruction({
  payerAddress,
  predictorAddress,
  roundId = DEFAULT_ROUND_ID,
  sessionAuthorityAddress,
  symbol,
  usdcMintAddress,
}: {
  payerAddress: string
  predictorAddress: string
  roundId?: bigint
  sessionAuthorityAddress: string
  symbol: string
  usdcMintAddress: string
}): Instruction {
  const payer = new PublicKey(payerAddress)
  const predictor = new PublicKey(predictorAddress)
  const sessionAuthority = new PublicKey(sessionAuthorityAddress)
  const usdcMint = new PublicKey(usdcMintAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const prediction = predictionPda(round, predictor)
  const vault = vaultPda(pool)
  const predictorTokenAccount = userTokenAccount(payerAddress, usdcMintAddress)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.READONLY),
      meta(round, AccountRole.READONLY),
      meta(prediction, AccountRole.WRITABLE),
      meta(predictor, AccountRole.READONLY),
      meta(sessionAuthority, AccountRole.READONLY),
      meta(payer, AccountRole.WRITABLE_SIGNER),
      meta(predictorTokenAccount, AccountRole.WRITABLE),
      meta(vault, AccountRole.WRITABLE),
      meta(usdcMint, AccountRole.READONLY),
      meta(TOKEN_PROGRAM_ID, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: coder.encode('fund_prediction', {}),
  }
}

export function getSelectTileOnErInstruction({
  predictorAddress,
  roundId = DEFAULT_ROUND_ID,
  sessionAuthorityAddress,
  symbol,
  tileIndex,
}: {
  predictorAddress: string
  roundId?: bigint
  sessionAuthorityAddress: string
  symbol: string
  tileIndex: number
}): Instruction {
  const predictor = new PublicKey(predictorAddress)
  const sessionAuthority = new PublicKey(sessionAuthorityAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const prediction = predictionPda(round, predictor)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.READONLY),
      meta(round, AccountRole.READONLY),
      meta(prediction, AccountRole.WRITABLE),
      meta(predictor, AccountRole.READONLY),
      meta(sessionAuthority, AccountRole.READONLY_SIGNER),
    ],
    data: coder.encode('select_tile_on_er', { tile_index: tileIndex }),
  }
}

export function getDelegateRoundInstruction({
  payerAddress,
  roundId = DEFAULT_ROUND_ID,
  symbol,
  validatorAddress = DEFAULT_MAGICBLOCK_ER_VALIDATOR,
}: {
  payerAddress: string
  roundId?: bigint
  symbol: string
  validatorAddress?: string
}): Instruction {
  const payer = new PublicKey(payerAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const buffer = delegateBufferPda(round)
  const delegationRecord = delegationRecordPda(round)
  const delegationMetadata = delegationMetadataPda(round)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(payer, AccountRole.WRITABLE_SIGNER),
      meta(pool, AccountRole.READONLY),
      meta(buffer, AccountRole.WRITABLE),
      meta(delegationRecord, AccountRole.WRITABLE),
      meta(delegationMetadata, AccountRole.WRITABLE),
      meta(round, AccountRole.WRITABLE),
      meta(TICK_PREDICTION_PROGRAM_ID, AccountRole.READONLY),
      meta(MAGICBLOCK_DELEGATION_PROGRAM_ID, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
      meta(validatorAddress, AccountRole.READONLY),
    ],
    data: coder.encode('delegate_round', { round_id: toBn(roundId) }),
  }
}

export function getDelegatePredictionInstruction({
  payerAddress,
  predictorAddress,
  roundId = DEFAULT_ROUND_ID,
  symbol,
  validatorAddress = DEFAULT_MAGICBLOCK_ER_VALIDATOR,
}: {
  payerAddress: string
  predictorAddress: string
  roundId?: bigint
  symbol: string
  validatorAddress?: string
}): Instruction {
  const payer = new PublicKey(payerAddress)
  const predictor = new PublicKey(predictorAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const prediction = predictionPda(round, predictor)
  const buffer = delegateBufferPda(prediction)
  const delegationRecord = delegationRecordPda(prediction)
  const delegationMetadata = delegationMetadataPda(prediction)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(payer, AccountRole.WRITABLE_SIGNER),
      meta(round, AccountRole.READONLY),
      meta(predictor, AccountRole.READONLY),
      meta(buffer, AccountRole.WRITABLE),
      meta(delegationRecord, AccountRole.WRITABLE),
      meta(delegationMetadata, AccountRole.WRITABLE),
      meta(prediction, AccountRole.WRITABLE),
      meta(TICK_PREDICTION_PROGRAM_ID, AccountRole.READONLY),
      meta(MAGICBLOCK_DELEGATION_PROGRAM_ID, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
      meta(validatorAddress, AccountRole.READONLY),
    ],
    data: coder.encode('delegate_prediction', {}),
  }
}

export function getCommitRoundInstruction({
  payerAddress,
  programId = TICK_PREDICTION_PROGRAM_ID,
  roundId = DEFAULT_ROUND_ID,
  symbol,
}: {
  payerAddress: string
  programId?: string
  roundId?: bigint
  symbol: string
}): Instruction {
  const payer = new PublicKey(payerAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(payer, AccountRole.WRITABLE_SIGNER),
      meta(round, AccountRole.WRITABLE),
      meta(programId, AccountRole.READONLY),
      meta(MAGICBLOCK_MAGIC_PROGRAM_ID, AccountRole.READONLY),
      meta(MAGICBLOCK_MAGIC_CONTEXT_ID, AccountRole.WRITABLE),
    ],
    data: coder.encode('commit_round', {}),
  }
}

export function getCommitPredictionInstruction({
  payerAddress,
  claimantAddress,
  programId = TICK_PREDICTION_PROGRAM_ID,
  roundId = DEFAULT_ROUND_ID,
  symbol,
}: {
  payerAddress: string
  claimantAddress: string
  programId?: string
  roundId?: bigint
  symbol: string
}): Instruction {
  const payer = new PublicKey(payerAddress)
  const claimant = new PublicKey(claimantAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const prediction = predictionPda(round, claimant)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(payer, AccountRole.WRITABLE_SIGNER),
      meta(round, AccountRole.READONLY),
      meta(prediction, AccountRole.WRITABLE),
      meta(programId, AccountRole.READONLY),
      meta(MAGICBLOCK_MAGIC_PROGRAM_ID, AccountRole.READONLY),
      meta(MAGICBLOCK_MAGIC_CONTEXT_ID, AccountRole.WRITABLE),
    ],
    data: coder.encode('commit_prediction', {}),
  }
}

export function getUndelegateRoundInstruction(args: Parameters<typeof getCommitRoundInstruction>[0]): Instruction {
  return {
    ...getCommitRoundInstruction(args),
    data: coder.encode('undelegate_round', {}),
  }
}

export function getUndelegatePredictionInstruction(
  args: Parameters<typeof getCommitPredictionInstruction>[0],
): Instruction {
  return {
    ...getCommitPredictionInstruction(args),
    data: coder.encode('undelegate_prediction', {}),
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
  authorityAddress,
  claimantAddress,
  roundId,
  symbol,
  usdcMintAddress,
}: {
  authorityAddress: string
  claimantAddress: string
  roundId: bigint
  symbol: string
  usdcMintAddress: string
}): Instruction {
  const authority = new PublicKey(authorityAddress)
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
      meta(authority, AccountRole.READONLY_SIGNER),
      meta(claimantTokenAccount, AccountRole.WRITABLE),
      meta(usdcMint, AccountRole.READONLY),
      meta(TOKEN_PROGRAM_ID, AccountRole.READONLY),
    ],
    data: coder.encode('claim_payout', {}),
  }
}
