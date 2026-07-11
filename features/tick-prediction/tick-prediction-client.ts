import { AccountRole, address, type Address, type Instruction } from '@solana/kit'
import { BN, BorshInstructionCoder } from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'

import { TICK_PREDICTION_IDL } from '@/constants/tick-prediction-idl'

export type PredictionDirection = 'up' | 'down'

export const TICK_PREDICTION_PROGRAM_ID = TICK_PREDICTION_IDL.address
export const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111'
export const DEFAULT_ROUND_ID = 1n
export const DEFAULT_ROUND_DURATION_SECONDS = 60n

const coder = new BorshInstructionCoder(TICK_PREDICTION_IDL as unknown as Idl)
const programPublicKey = new PublicKey(TICK_PREDICTION_PROGRAM_ID)

function toAddress(publicKey: PublicKey | string): Address {
  return address(publicKey.toString())
}

function meta(publicKey: PublicKey | string, role: AccountRole) {
  return { address: toAddress(publicKey), role }
}

function poolPda(symbol: string) {
  return PublicKey.findProgramAddressSync([Buffer.from('pool'), Buffer.from(symbol)], programPublicKey)[0]
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

export function getTickPredictionAddresses(symbol: string, predictorAddress: string, roundId = DEFAULT_ROUND_ID) {
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const prediction = predictionPda(round, new PublicKey(predictorAddress))

  return {
    pool: pool.toString(),
    prediction: prediction.toString(),
    round: round.toString(),
  }
}

export function getInitializePoolInstruction({
  authorityAddress,
  durationSeconds = DEFAULT_ROUND_DURATION_SECONDS,
  symbol,
}: {
  authorityAddress: string
  durationSeconds?: bigint
  symbol: string
}): Instruction {
  const authority = new PublicKey(authorityAddress)
  const pool = poolPda(symbol)

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(pool, AccountRole.WRITABLE),
      meta(authority, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: coder.encode('initialize_pool', { duration_seconds: toBn(durationSeconds), symbol }),
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

export function getPlacePredictionInstruction({
  direction,
  predictorAddress,
  symbol,
  roundId = DEFAULT_ROUND_ID,
}: {
  direction: PredictionDirection
  predictorAddress: string
  symbol: string
  roundId?: bigint
}): Instruction {
  const predictor = new PublicKey(predictorAddress)
  const pool = poolPda(symbol)
  const round = roundPda(pool, roundId)
  const prediction = predictionPda(round, predictor)
  const encodedDirection = direction === 'up' ? { Up: {} } : { Down: {} }

  return {
    programAddress: toAddress(TICK_PREDICTION_PROGRAM_ID),
    accounts: [
      meta(round, AccountRole.READONLY),
      meta(prediction, AccountRole.WRITABLE),
      meta(predictor, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: coder.encode('place_prediction', { direction: encodedDirection }),
  }
}
